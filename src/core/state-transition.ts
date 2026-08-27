import type { ConversationRepository } from "../db/repositories/conversation-repository";
import type { EventRepository } from "../db/repositories/event-repository";
import type { ConversationState } from "./types";

/**
 * FR-4.2: every state transition must be a logged event, not just a silent
 * field mutation — schema.sql's own comment on `conversations` promises
 * history can be reconstructed by replay, which only holds if every
 * `setState` call is paired with a `state_changed` event the same way
 * app/api/desk/[conversationId]/handback/route.ts already does it.
 */
export async function setConversationState(
  conversations: ConversationRepository,
  events: EventRepository,
  conversationId: string,
  state: ConversationState,
  actor: string,
  extraPayload?: Record<string, unknown>,
): Promise<void> {
  await conversations.setState(conversationId, state);
  await events.append({ conversationId, type: "state_changed", actor, payload: { to: state, ...extraPayload } });
}
