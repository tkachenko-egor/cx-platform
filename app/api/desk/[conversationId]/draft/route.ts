import { getPlatformContext } from "../../../../../src/platform/context";
import { ConversationRepository } from "../../../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../../../src/db/repositories/message-repository";
import { RunRepository } from "../../../../../src/db/repositories/run-repository";
import { AgentDefRepository } from "../../../../../src/db/repositories/agent-def-repository";
import { getOrCreateSession } from "../../../../../src/agents/sessions-store";
import { runAgentTurn } from "../../../../../src/agents/runtime";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import { DEFAULT_AGENT_KEY } from "../../../../../src/channel/turn";

export const runtime = "nodejs";

/**
 * FR-9.6 copilot mode: generates a suggested reply for a human to review —
 * never auto-sent, never appended to the conversation transcript. Only
 * committing it (POST .../reply) makes it real.
 */
export async function POST(_req: Request, context: RouteContext<"/api/desk/[conversationId]/draft">) {
  const { conversationId } = await context.params;
  const { db, tenant, gateway, embeddings } = getPlatformContext();

  try {
    await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const conversation = new ConversationRepository(db, tenant).get(conversationId);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });

  const agentDefs = new AgentDefRepository(db, tenant);
  // Whichever specialist routing/handoff left this conversation pinned to
  // (support-generalist if no router is configured) — never hardcoded,
  // since a routed conversation's current agent may not be the default.
  const agentKey = conversation.currentAgentId ?? DEFAULT_AGENT_KEY;
  const agentVersion = (conversation.metadata.agentVersion as number | undefined) ?? 1;
  const agent = agentDefs.getVersion(agentKey, agentVersion) ?? agentDefs.getLatestPublished(agentKey);
  if (!agent) return Response.json({ error: "No agent definition available" }, { status: 500 });

  const messages = new MessageRepository(db, tenant).listByConversation(conversationId, { includeInternal: true });
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) return Response.json({ error: "No customer message to reply to" }, { status: 400 });

  const session = getOrCreateSession(conversationId);
  const last = session.history[session.history.length - 1];
  const draftFromLast = last?.role === "user";
  const historyForDraft = draftFromLast ? session.history.slice(0, -1) : session.history;
  const userText = draftFromLast ? last.content : lastUserMessage.content;

  const runs = new RunRepository(db, tenant);
  const run = runs.start({ conversationId, agentKey: agent.key, agentVersion: agent.version, trigger: "human_draft_request" });

  try {
    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, conversationId, run.id, agent, historyForDraft, userText);
    runs.complete(run.id, "completed");
    return Response.json({ draftText: result.assistantText, cards: result.cards, citableDocs: result.citableDocs });
  } catch (err) {
    runs.complete(run.id, "failed");
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
