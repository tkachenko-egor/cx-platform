import { ConversationRepository } from "../../../../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../../../../src/db/repositories/message-repository";
import { getWidgetContext } from "../../../../../../src/platform/widget-context";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Public, CORS-enabled sibling of app/api/conversations/[conversationId]/messages/route.ts — same polling-for-a-human-reply purpose, resolved via the widget's public key instead of the Host header. */
export async function GET(_req: Request, ctx: RouteContext<"/api/embed-chat/[publicKey]/messages/[conversationId]">) {
  const { publicKey, conversationId } = await ctx.params;
  const widget = getWidgetContext(publicKey);
  if (!widget) return Response.json({ error: "Widget not found" }, { status: 404, headers: CORS_HEADERS });

  const conversation = new ConversationRepository(widget.db, widget.tenant).get(conversationId);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404, headers: CORS_HEADERS });

  const messages = new MessageRepository(widget.db, widget.tenant).listByConversation(conversationId);
  return Response.json(
    { state: conversation.state, messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })) },
    { headers: CORS_HEADERS },
  );
}
