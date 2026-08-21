import { getPlatformContext } from "../../../../../src/platform/context";
import { ConversationRepository } from "../../../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../../../src/db/repositories/message-repository";

export const runtime = "nodejs";

/**
 * Polled by the widget while a conversation is out of bot_active (FR-9.4/9.6
 * copilot mode): the customer's tab needs some way to pick up a human
 * agent's reply, and the six-week cut's channel layer doesn't have a
 * push transport for that direction yet — polling is the honest, cheap
 * answer rather than building bidirectional SSE/WebSocket for it now.
 */
export async function GET(_req: Request, context: RouteContext<"/api/conversations/[conversationId]/messages">) {
  const { conversationId } = await context.params;
  const { db, tenant } = getPlatformContext();
  const conversation = new ConversationRepository(db, tenant).get(conversationId);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = new MessageRepository(db, tenant).listByConversation(conversationId);
  return Response.json({
    state: conversation.state,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
  });
}
