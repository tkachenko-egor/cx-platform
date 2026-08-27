import type { TenantContext } from "../tenancy/context";
import type { SqlDatabase } from "../db/pg";
import { MessageRepository } from "../db/repositories/message-repository";
import { MessageFeedbackRepository, type FeedbackRating } from "../db/repositories/message-feedback-repository";

export class FeedbackValidationError extends Error {}

/**
 * Phase 9 M4: shared by both feedback routes (same-origin app/api/chat/feedback
 * and the public app/api/embed-chat/[publicKey]/feedback) — validates the
 * message actually belongs to the claimed conversation/tenant before
 * recording anything, same "never trust the client's IDs" spirit as every
 * other tenant-scoped write in this codebase.
 */
export async function recordMessageFeedback(
  db: SqlDatabase,
  tenant: TenantContext,
  input: { conversationId: string; messageId: string; rating: FeedbackRating; comment?: string | null },
) {
  const message = await new MessageRepository(db, tenant).get(input.messageId);
  if (!message || message.conversationId !== input.conversationId) {
    throw new FeedbackValidationError("Message not found in this conversation");
  }
  return await new MessageFeedbackRepository(db, tenant).record(input);
}
