import { now } from "./clock";
import type { SlaPolicy, SlaPolicyRepository } from "../db/repositories/sla-policy-repository";
import type { ConversationRepository } from "../db/repositories/conversation-repository";
import type { ConversationChannel, ConversationPriority } from "./types";

/**
 * Phase 2 M4: naive elapsed-time math — target_minutes added directly to
 * the timestamp a conversation entered awaiting_human. Real-world elapsed
 * time is timezone-independent, so tenants.timezone (added in M1) isn't
 * threaded through here; it exists for a later business-hours-calendar cut,
 * which this deliberately does not attempt (same spirit as the Phase 1
 * six-week cut's own trims).
 */
export function computeDueAt(policy: SlaPolicy | undefined, fromTimestamp: string = now()): string | null {
  if (!policy) return null;
  const from = new Date(fromTimestamp).getTime();
  return new Date(from + policy.targetMinutes * 60_000).toISOString();
}

/**
 * Starts (or restarts) the SLA clock for a conversation entering
 * awaiting_human. A tenant with no matching policy just gets sla_due_at
 * left null — same "unconfigured feature is a no-op" convention as an
 * agent with no handoffTargets configured (src/channel/turn.ts).
 */
export function startSlaClock(
  conversations: ConversationRepository,
  slaPolicies: SlaPolicyRepository,
  conversationId: string,
  priority: ConversationPriority,
  channel: ConversationChannel,
): void {
  const policy = slaPolicies.findForPriorityAndChannel(priority, channel);
  conversations.setSlaDueAt(conversationId, computeDueAt(policy));
}

/** Stops the SLA clock — a human replied, or the conversation was handed back to the bot. */
export function clearSlaClock(conversations: ConversationRepository, conversationId: string): void {
  conversations.setSlaDueAt(conversationId, null);
}
