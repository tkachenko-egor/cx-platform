import { randomUUID } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface KbRetrievalLogEntry {
  id: string;
  tenantId: string;
  conversationId: string;
  runId: string;
  queryText: string;
  bestScore: number;
  retrievedDocIds: string[];
  /** A1: whether the cross-encoder rerank stage reordered this retrieval. */
  reranked: boolean;
  createdAt: string;
}

interface KbRetrievalLogRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  run_id: string;
  query_text: string;
  best_score: number;
  retrieved_doc_ids: string;
  reranked: boolean;
  created_at: string;
}

function rowToEntry(row: KbRetrievalLogRow): KbRetrievalLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    queryText: row.query_text,
    bestScore: row.best_score,
    retrievedDocIds: fromJson<string[]>(row.retrieved_doc_ids),
    reranked: row.reranked,
    createdAt: row.created_at,
  };
}

/** Coverage-gap reporting substrate: one row per retrieval, regardless of whether the turn later escalates. */
export class KbRetrievalLogRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async record(input: { conversationId: string; runId: string; queryText: string; bestScore: number; retrievedDocIds: string[]; reranked?: boolean }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO kb_retrieval_log (id, tenant_id, conversation_id, run_id, query_text, best_score, retrieved_doc_ids, reranked, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), this.tenantId, input.conversationId, input.runId, input.queryText, input.bestScore, JSON.stringify(input.retrievedDocIds), input.reranked ?? false, new Date().toISOString());
  }

  /** Excludes 'test_harness' conversations (agent-builder live-preview turns) — coverage gaps should reflect real traffic, not draft testing. */
  async listLowConfidence(thresholdScore: number, since?: string): Promise<KbRetrievalLogEntry[]> {
    const previewExclusion = `NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = kb_retrieval_log.conversation_id AND c.channel = 'test_harness')`;
    const rows = since
      ? (await this.db
          .prepare(`SELECT * FROM kb_retrieval_log WHERE tenant_id = ? AND best_score < ? AND created_at >= ? AND ${previewExclusion} ORDER BY created_at DESC`)
          .all(this.tenantId, thresholdScore, since) as KbRetrievalLogRow[])
      : (await this.db
          .prepare(`SELECT * FROM kb_retrieval_log WHERE tenant_id = ? AND best_score < ? AND ${previewExclusion} ORDER BY created_at DESC`)
          .all(this.tenantId, thresholdScore) as KbRetrievalLogRow[]);
    return rows.map(rowToEntry);
  }
}
