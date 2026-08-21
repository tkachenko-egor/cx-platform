/**
 * Canonical conversation-core types (FR-4.1). Every channel adapter and
 * every agent speaks these types and nothing else — no channel-specific or
 * provider-specific shape may leak in here.
 */

export type ConversationChannel = "widget" | "email" | "test_harness";

/**
 * FR-4.2: transitions are logged events, not silent field mutations —
 * see ConversationEvent below. This type only names the states.
 */
export type ConversationState =
  | "bot_active"
  | "awaiting_human"
  | "human_active"
  | "snoozed"
  | "resolved"
  | "closed";

/** Phase 2 M4: drives SLA policy lookup (src/core/sla.ts). Defaults to "normal" — nothing assigns a higher priority yet. */
export type ConversationPriority = "low" | "normal" | "high" | "urgent";

export type MessageRole =
  | "user"
  | "assistant"
  | "agent_human"
  | "system"
  | "tool_call"
  | "tool_result"
  | "handoff"
  | "note";

/** FR-4.4 note: "note" is internal and must never reach the customer. */
export type MessageVisibility = "public" | "internal";

export interface CanonicalMessage {
  id: string;
  conversationId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  contentType: "text" | "json";
  authorType: "customer" | "bot" | "human" | "system";
  authorId: string | null;
  visibility: MessageVisibility;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  tenantId: string;
  customerId: string | null;
  channel: ConversationChannel;
  state: ConversationState;
  currentAgentId: string | null;
  assigneeId: string | null;
  priority: ConversationPriority;
  /** Phase 2 M6b: cheapest available "skill area" signal — set to [currentAgentKey] whenever the handling agent changes, read by src/desk/skill-match.ts for assignee suggestions. */
  tags: string[];
  /** Phase 2 M4: set when a conversation enters awaiting_human, cleared when it leaves — null means no SLA clock is running. */
  slaDueAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type ConversationEventType =
  | "state_changed"
  | "handoff"
  | "assigned"
  | "escalated"
  | "message_appended";

/** Append-only (FR-4.3): a conversation's history is reconstructed by replay, never by reading mutated fields. */
export interface ConversationEvent {
  id: string;
  conversationId: string;
  tenantId: string;
  type: ConversationEventType;
  payload: Record<string, unknown>;
  actor: string;
  createdAt: string;
}
