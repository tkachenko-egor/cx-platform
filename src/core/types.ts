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
