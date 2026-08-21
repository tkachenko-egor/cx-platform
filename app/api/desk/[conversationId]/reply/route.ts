import { getPlatformContext } from "../../../../../src/platform/context";
import { ConversationRepository } from "../../../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../../../src/db/repositories/message-repository";
import { EventRepository } from "../../../../../src/db/repositories/event-repository";
import { getOrCreateSession } from "../../../../../src/agents/sessions-store";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import { setConversationState } from "../../../../../src/core/state-transition";
import { clearSlaClock } from "../../../../../src/core/sla";

export const runtime = "nodejs";

/** FR-9.6: committing a (possibly edited) draft — this is what actually reaches the customer. */
export async function POST(req: Request, context: RouteContext<"/api/desk/[conversationId]/reply">) {
  const { conversationId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });

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

  const events = new EventRepository(db, tenant);
  new MessageRepository(db, tenant).append({ conversationId, role: "agent_human", content: text });
  setConversationState(conversations, events, conversationId, "human_active", staffUser.id);
  clearSlaClock(conversations, conversationId); // a human has now responded — the "time to first response" clock stops
  events.append({ conversationId, type: "assigned", actor: staffUser.id, payload: { action: "reply_sent" } });

  // Keep the model's own continuity in sync in case the conversation is
  // later handed back to the bot mid-thread.
  const session = getOrCreateSession(conversationId);
  session.history.push({ role: "assistant", content: text });

  return Response.json({ ok: true });
}
