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
}

const store = new Map<string, SessionEntry>();

export function getOrCreateSession(conversationId: string): SessionEntry {
  let entry = store.get(conversationId);
  if (!entry) {
    entry = { history: [], turnCount: 0 };
    store.set(conversationId, entry);
  }
  return entry;
}
