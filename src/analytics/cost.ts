import type Database from "better-sqlite3";
import type { TenantContext } from "../tenancy/context";

export interface ConversationCostSummary {
  conversationId: string;
  turnCount: number;
  totalCostUsd: number;
}

/** FR-11.6: cost per conversation. Joins runs -> llm_calls, per the data-model sketch's "almost every debugging and cost question is answered by joining from here." */
export async function getConversationCostSummaries(db: Database.Database, tenant: TenantContext, conversationIds: string[]): Promise<Map<string, ConversationCostSummary>> {
  if (conversationIds.length === 0) return new Map();
  const placeholders = conversationIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT r.conversation_id as conversationId, COUNT(DISTINCT r.id) as turnCount, COALESCE(SUM(lc.cost_usd), 0) as totalCostUsd
       FROM runs r
       LEFT JOIN llm_calls lc ON lc.run_id = r.id AND lc.tenant_id = r.tenant_id
       WHERE r.tenant_id = ? AND r.conversation_id IN (${placeholders})
       GROUP BY r.conversation_id`,
    )
    .all(tenant.tenantId, ...conversationIds) as ConversationCostSummary[];
  return new Map(rows.map((r) => [r.conversationId, r]));
}
