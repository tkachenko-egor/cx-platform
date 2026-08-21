import { getPlatformContext } from "../../../../../src/platform/context";
import { ConversationRepository } from "../../../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../../../src/db/repositories/message-repository";
import { EventRepository } from "../../../../../src/db/repositories/event-repository";
import { getOrCreateSession } from "../../../../../src/agents/sessions-store";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** FR-9.6: committing a (possibly edited) draft — this is what actually reaches the customer. */
export async function POST(req: Request, context: RouteContext<"/api/desk/[conversationId]/reply">) {
  const { conversationId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });

  const { db, tenant } = getPlatformContext();
  let staffUser;
  try {
    staffUser = await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const conversations = new ConversationRepository(db, tenant);
  const conversation = conversations.get(conversationId);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });

  new MessageRepository(db, tenant).append({ conversationId, role: "agent_human", content: text });
  conversations.setState(conversationId, "human_active");
  new EventRepository(db, tenant).append({ conversationId, type: "assigned", actor: staffUser.id, payload: { action: "reply_sent" } });

  // Keep the model's own continuity in sync in case the conversation is
  // later handed back to the bot mid-thread.
  const session = getOrCreateSession(conversationId);
  session.history.push({ role: "assistant", content: text });

  return Response.json({ ok: true });
}
