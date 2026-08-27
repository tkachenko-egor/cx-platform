import { getPlatformContext } from "../../../src/platform/context";
import { ConversationRepository } from "../../../src/db/repositories/conversation-repository";
import { checkIpRateLimit } from "../../../src/channel/rate-limit";
import { WidgetChannelAdapter } from "../../../src/channel/widget-adapter";
import { ensureConversation, processInboundTurn } from "../../../src/channel/turn";

// better-sqlite3 needs the Node runtime, not edge.
export const runtime = "nodejs";

const widgetAdapter = new WidgetChannelAdapter();

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

  const inbound = widgetAdapter.receive({ conversationId: body.conversationId, message: body.message ?? "" });
  const messageText = inbound.text.trim();
  if (!messageText) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
  }
  if (messageText.length > 2000) {
    return new Response(JSON.stringify({ error: "message exceeds the 2000 character limit" }), { status: 400 });
  }

  const { db, tenant, gateway, embeddings } = await getPlatformContext();
  const conversations = new ConversationRepository(db, tenant);

  let conversation;
  try {
    const existing = inbound.conversationId ? await conversations.get(inbound.conversationId) : undefined;
    conversation = await ensureConversation({ db }, tenant, existing, "widget");
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }

  const conversationId = conversation.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sseEvent(data)));
      send({ type: "meta", conversationId });

      try {
        const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId, text: messageText }, {
          onTextDelta: (delta) => send({ type: "text", delta }),
          onToolStart: (name) => send({ type: "tool_start", name }),
        });

        if (result.handoff) send({ type: "handoff", state: result.state });
        send({ type: "done", cards: result.cards ?? [], citableDocs: result.citableDocs, loopCapHit: result.loopCapHit, assistantMessageId: result.assistantMessageId });
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
