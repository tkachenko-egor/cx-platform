import type { TenantContext } from "../../tenancy/context";
import type { SqlDatabase } from "../pg";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface LlmCallRecord {
  id: string;
  runId: string;
  modelAlias: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
  errorType: string | null;
}

interface LlmCallRow {
  id: string;
  run_id: string;
  model_alias: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  latency_ms: number;
  fallback_used: boolean;
  error_type: string | null;
}

function rowToRecord(row: LlmCallRow): LlmCallRecord {
  return {
    id: row.id,
    runId: row.run_id,
    modelAlias: row.model_alias,
    provider: row.provider,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    cachedTokens: row.cached_tokens,
    costUsd: row.cost_usd,
    latencyMs: row.latency_ms,
    fallbackUsed: Boolean(row.fallback_used),
    errorType: row.error_type,
  };
}

/** FR-5.10 usage accounting + FR-13.1 basic tracing, one row per call attempt. */
export class LlmCallRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async record(entry: LlmCallRecord): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO llm_calls (
           id, tenant_id, run_id, model_alias, provider, model,
           prompt_tokens, completion_tokens, cached_tokens, cost_usd,
           latency_ms, fallback_used, error_type, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        this.tenantId,
        entry.runId,
        entry.modelAlias,
        entry.provider,
        entry.model,
        entry.promptTokens,
        entry.completionTokens,
        entry.cachedTokens,
        entry.costUsd,
        entry.latencyMs,
        entry.fallbackUsed,
        entry.errorType,
        now,
      );
  }

  async listByRun(runId: string): Promise<LlmCallRecord[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM llm_calls WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC`)
      .all(this.tenantId, runId) as LlmCallRow[];
    return rows.map(rowToRecord);
  }

  /** Phase 7 M2: per-conversation cost ceiling check — sums every llm_calls row across every run (turn) this conversation has had so far, joined through runs.conversation_id since llm_calls itself only carries run_id. */
  async sumCostForConversation(conversationId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(lc.cost_usd), 0) as total FROM llm_calls lc
         JOIN runs r ON r.id = lc.run_id AND r.tenant_id = lc.tenant_id
         WHERE lc.tenant_id = ? AND r.conversation_id = ?`,
      )
      .get(this.tenantId, conversationId) as { total: number };
    return row.total;
  }
}
