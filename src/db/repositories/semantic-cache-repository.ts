import { randomUUID } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface SemanticCacheEntry {
  id: string;
  tenantId: string;
  agentKey: string;
  queryText: string;
  queryEmbedding: number[];
  responseText: string;
  citableDocs: { docId: string; title: string }[];
  hitCount: number;
  createdAt: string;
  lastHitAt: string | null;
}

interface SemanticCacheRow {
  id: string;
  tenant_id: string;
  agent_key: string;
  query_text: string;
  query_embedding: string;
  response_text: string;
  citable_docs: string;
  hit_count: number;
  created_at: string;
  last_hit_at: string | null;
}

function rowToEntry(row: SemanticCacheRow): SemanticCacheEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentKey: row.agent_key,
    queryText: row.query_text,
    queryEmbedding: fromJson<number[]>(row.query_embedding),
    responseText: row.response_text,
    citableDocs: fromJson(row.citable_docs) as { docId: string; title: string }[],
    hitCount: row.hit_count,
    createdAt: row.created_at,
    lastHitAt: row.last_hit_at,
  };
}

/** Phase 2 M3b: opt-in per-agent semantic response cache — see src/kb/semantic-cache.ts for the similarity lookup logic that sits on top of this. */
export class SemanticCacheRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async record(input: { agentKey: string; queryText: string; queryEmbedding: number[]; responseText: string; citableDocs: { docId: string; title: string }[] }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO semantic_cache (id, tenant_id, agent_key, query_text, query_embedding, response_text, citable_docs, hit_count, created_at, last_hit_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
      )
      .run(randomUUID(), this.tenantId, input.agentKey, input.queryText, JSON.stringify(input.queryEmbedding), input.responseText, JSON.stringify(input.citableDocs), new Date().toISOString());
  }

  async listByAgent(agentKey: string): Promise<SemanticCacheEntry[]> {
    const rows = await this.db.prepare(`SELECT * FROM semantic_cache WHERE tenant_id = ? AND agent_key = ?`).all(this.tenantId, agentKey) as SemanticCacheRow[];
    return rows.map(rowToEntry);
  }

  async recordHit(id: string): Promise<void> {
    await this.db.prepare(`UPDATE semantic_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE tenant_id = ? AND id = ?`).run(new Date().toISOString(), this.tenantId, id);
  }
}
