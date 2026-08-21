import { getPlatformContext } from "../../../src/platform/context";
import { ConversationRepository } from "../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../src/db/repositories/message-repository";
import { EventRepository } from "../../../src/db/repositories/event-repository";
import { RunRepository } from "../../../src/db/repositories/run-repository";
import { AgentDefRepository } from "../../../src/db/repositories/agent-def-repository";
import { checkIpRateLimit, conversationTurnCapExceeded } from "../../../src/channel/rate-limit";
import { getOrCreateSession } from "../../../src/agents/sessions-store";
import { withConversationLock } from "../../../src/agents/conversation-lock";
import { runAgentTurn } from "../../../src/agents/runtime";

// better-sqlite3 needs the Node runtime, not edge.
export const runtime = "nodejs";

const DEFAULT_AGENT_KEY = "support-generalist";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rateLimit = checkIpRateLimit(ip);
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) },
    });
  }

  let body: { conversationId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const messageText = body.message?.trim();
  if (!messageText) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
  }
  if (messageText.length > 2000) {
    return new Response(JSON.stringify({ error: "message exceeds the 2000 character limit" }), { status: 400 });
  }

  const { db, tenant } = getPlatformContext();
  const conversations = new ConversationRepository(db, tenant);
  const messages = new MessageRepository(db, tenant);
  const events = new EventRepository(db, tenant);
  const runs = new RunRepository(db, tenant);
  const agentDefs = new AgentDefRepository(db, tenant);

  let conversation = body.conversationId ? conversations.get(body.conversationId) : undefined;
  if (!conversation) {
    const published = agentDefs.getLatestPublished(DEFAULT_AGENT_KEY);
    if (!published) {
      return new Response(JSON.stringify({ error: "No published agent — run `npm run seed` first." }), { status: 500 });
    }
    conversation = conversations.create({ channel: "widget", agentKey: DEFAULT_AGENT_KEY, metadata: { agentVersion: published.version } });
    events.append({ conversationId: conversation.id, type: "state_changed", actor: "system", payload: { to: "bot_active" } });
  }

  const conversationId = conversation.id;
  const session = getOrCreateSession(conversationId);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sseEvent(data)));
      send({ type: "meta", conversationId });

      try {
        await withConversationLock(conversationId, async () => {
          const current = conversations.get(conversationId)!;
          messages.append({ conversationId, role: "user", content: messageText });

          if (current.state !== "bot_active") {
            // Still recorded for the model's own continuity (src/agents/sessions-store.ts)
            // so a human's later "generate draft" request has full context —
            // just not auto-answered while a human is handling the conversation.
            session.history.push({ role: "user", content: messageText });
            send({ type: "handoff", state: current.state });
            send({ type: "done", cards: [], loopCapHit: false });
            return;
          }

          if (conversationTurnCapExceeded(session.turnCount)) {
            send({ type: "text", delta: "We've covered a lot of ground in this conversation — let me hand you to a colleague to pick up from here." });
            conversations.setState(conversationId, "awaiting_human");
            events.append({ conversationId, type: "escalated", actor: "system", payload: { reasons: ["loop_cap"] } });
            send({ type: "handoff", state: "awaiting_human" });
            send({ type: "done", cards: [], loopCapHit: true });
            return;
          }

          const agentVersion = (current.metadata.agentVersion as number | undefined) ?? 1;
          const agent = agentDefs.getVersion(DEFAULT_AGENT_KEY, agentVersion) ?? agentDefs.getLatestPublished(DEFAULT_AGENT_KEY);
          if (!agent) throw new Error("No agent definition available");

          const run = runs.start({ conversationId, agentKey: agent.key, agentVersion: agent.version, trigger: "user_message" });
          session.turnCount++;

          try {
            const { gateway, embeddings } = getPlatformContext();
            const result = await runAgentTurn({ db, gateway, embeddings }, tenant, conversationId, run.id, agent, session.history, messageText, {
              onTextDelta: (delta) => send({ type: "text", delta }),
              onToolStart: (name) => send({ type: "tool_start", name }),
            });

            session.history = result.updatedHistory;
            messages.append({ conversationId, role: "assistant", content: result.assistantText });
            runs.complete(run.id, "completed");

            if (result.escalate) {
              conversations.setState(conversationId, "awaiting_human");
              events.append({ conversationId, type: "escalated", actor: "system", payload: { reasons: result.escalationReasons } });
              send({ type: "handoff", state: "awaiting_human" });
            }

            send({ type: "done", cards: result.cards, citableDocs: result.citableDocs, loopCapHit: result.loopCapHit });
          } catch (err) {
            runs.complete(run.id, "failed");
            throw err;
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: "I'm having trouble reaching my systems — give me a moment and try again.", detail: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
