import type { ChatMessage } from "../gateway/types";
import type { SqlDatabase } from "../db/pg";
import type { TenantContext } from "../tenancy/context";
import { AgentSessionRepository } from "../db/repositories/agent-session-repository";

/**
 * B6: the full gateway-shape turn history (including tool_use/tool_result
 * blocks the model needs for continuity) is persisted in `agent_sessions`
 * (was an in-process `Map` — NFR-3.1). The customer/human-desk transcript is
 * still persisted separately via `MessageRepository`; this store only gives
 * the model its own replay context.
 *
 * There's no live object to mutate any more: callers `getOrCreateSession`,
 * mutate the returned plain object, then call the matching `save*` helper.
 * History/turnCount and the tool-failure counter persist independently so the
 * channel turn and the agent runtime don't clobber each other.
 */
export interface SessionEntry {
  history: ChatMessage[];
  turnCount: number;
  /** Phase 8 M1: consecutive tool-call errors within this conversation — reset on any successful tool result, checked against agent_defs.escalation_config.nFailedAttempts (src/agents/runtime.ts). */
  consecutiveToolFailures: number;
}

export async function getOrCreateSession(db: SqlDatabase, tenant: TenantContext, conversationId: string): Promise<SessionEntry> {
  return new AgentSessionRepository(db, tenant).load(conversationId);
}

/** Persist the channel turn's fields (replay history + turn count). */
export async function saveSessionHistory(db: SqlDatabase, tenant: TenantContext, conversationId: string, entry: Pick<SessionEntry, "history" | "turnCount">): Promise<void> {
  await new AgentSessionRepository(db, tenant).saveHistory(conversationId, entry.history, entry.turnCount);
}

/** Persist the agent runtime's tool-failure counter. */
export async function saveSessionToolFailures(db: SqlDatabase, tenant: TenantContext, conversationId: string, count: number): Promise<void> {
  await new AgentSessionRepository(db, tenant).saveToolFailures(conversationId, count);
}
