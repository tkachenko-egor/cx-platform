import { getPlatformContext } from "../../../../../src/platform/context";
import { ConversationRepository } from "../../../../../src/db/repositories/conversation-repository";
import { EventRepository } from "../../../../../src/db/repositories/event-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import { setConversationState } from "../../../../../src/core/state-transition";
import { clearSlaClock } from "../../../../../src/core/sla";

export const runtime = "nodejs";

/** FR-9.5: hand a conversation back to the bot after a human has helped. */
export async function POST(_req: Request, context: RouteContext<"/api/desk/[conversationId]/handback">) {
  const { conversationId } = await context.params;
  const { db, tenant } = await getPlatformContext();
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

  setConversationState(conversations, new EventRepository(db, tenant), conversationId, "bot_active", staffUser.id);
  clearSlaClock(conversations, conversationId);

  return Response.json({ ok: true });
}
