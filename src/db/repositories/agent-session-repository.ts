import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { ChatMessage } from "../../gateway/types";
import type { SessionEntry } from "../../agents/sessions-store";

/**
 * B6: the model's own replay history + per-conversation counters, persisted
 * (was an in-process `Map`). Tenant-scoped, so RLS (B5) applies. The channel
 * turn and the agent runtime write different columns, so each `save*` method
 * upserts only its own — see migration 004.
 */
export class AgentSessionRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  /** Returns the stored entry, or a fresh zero-value one — never writes a row (a draft/preview turn shouldn't create session state). */
  async load(conversationId: string): Promise<SessionEntry> {
    const row = await this.db
      .prepare(
        `SELECT history, turn_count AS "turnCount", consecutive_tool_failures AS "consecutiveToolFailures"
         FROM agent_sessions WHERE tenant_id = ? AND conversation_id = ?`,
      )
      .get<{ history: unknown; turnCount: number; consecutiveToolFailures: number }>(this.tenantId, conversationId);
    if (!row) return { history: [], turnCount: 0, consecutiveToolFailures: 0 };
    return { history: fromJson<ChatMessage[]>(row.history), turnCount: row.turnCount, consecutiveToolFailures: row.consecutiveToolFailures };
  }

  /** Channel-turn writer: the replay history and turn count. */
  async saveHistory(conversationId: string, history: ChatMessage[], turnCount: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_sessions (tenant_id, conversation_id, history, turn_count, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, conversation_id)
         DO UPDATE SET history = excluded.history, turn_count = excluded.turn_count, updated_at = excluded.updated_at`,
      )
      .run(this.tenantId, conversationId, JSON.stringify(history), turnCount, new Date().toISOString());
  }

  /** Agent-runtime writer: the consecutive-tool-failure counter (Phase 8 M1). */
  async saveToolFailures(conversationId: string, count: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_sessions (tenant_id, conversation_id, consecutive_tool_failures, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, conversation_id)
         DO UPDATE SET consecutive_tool_failures = excluded.consecutive_tool_failures, updated_at = excluded.updated_at`,
      )
      .run(this.tenantId, conversationId, count, new Date().toISOString());
  }

  /** Retention: drop sessions untouched since `cutoffIso`. Driven by `scripts/prune-agent-sessions.ts`. */
  async pruneOlderThan(cutoffIso: string): Promise<number> {
    const res = await this.db.prepare(`DELETE FROM agent_sessions WHERE tenant_id = ? AND updated_at < ?`).run(this.tenantId, cutoffIso);
    return res.changes;
  }
}
