import type { ChatMessage } from "../gateway/types";

/**
 * The full gateway-shape turn history (including tool_use/tool_result
 * blocks the model needs for continuity) lives here, in-process — the
 * same simplification amarelle-handoff's lib/agent/sessions-store.ts made,
 * and for the same reason: it's fine for a single-process Phase 1
 * deployment, and NFR-3.1's "conversation state in the database, not
 * process memory" is explicitly not in this phase's scope. The
 * customer/human-desk-visible transcript is persisted separately via
 * MessageRepository regardless — this store only exists to give the model
 * its own continuity.
 */
export interface SessionEntry {
  history: ChatMessage[];
  turnCount: number;
  /** Phase 8 M1: consecutive tool-call errors within this conversation — reset on any successful tool result, checked against agent_defs.escalation_config.nFailedAttempts (src/agents/runtime.ts). */
  consecutiveToolFailures: number;
}

const store = new Map<string, SessionEntry>();

export function getOrCreateSession(conversationId: string): SessionEntry {
  let entry = store.get(conversationId);
  if (!entry) {
    entry = { history: [], turnCount: 0, consecutiveToolFailures: 0 };
    store.set(conversationId, entry);
  }
  return entry;
}
