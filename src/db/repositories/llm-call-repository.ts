import type Database from "better-sqlite3";
import type { TenantContext } from "../../tenancy/context";
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
  fallback_used: number;
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
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  record(entry: LlmCallRecord): void {
    const now = new Date().toISOString();
    this.db
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
        entry.fallbackUsed ? 1 : 0,
        entry.errorType,
        now,
      );
  }

  listByRun(runId: string): LlmCallRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM llm_calls WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC`)
      .all(this.tenantId, runId) as LlmCallRow[];
    return rows.map(rowToRecord);
  }
}
