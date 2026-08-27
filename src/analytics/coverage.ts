import type Database from "better-sqlite3";
import type { TenantContext } from "../tenancy/context";
import { KbRetrievalLogRepository } from "../db/repositories/kb-retrieval-log-repository";

export interface CoverageGap {
  queryText: string;
  bestScore: number;
  retrievedDocIds: string[];
  createdAt: string;
}

/**
 * RRF fusion (src/kb/retrieval.ts, RRF_K=60) scores by RANK, not raw
 * similarity — a rank-0 match always scores 1/61 ≈ 0.0164 whether or not
 * it's actually a good match, so "no candidates at all" (score 0) isn't
 * the only case worth flagging. The threshold sits between a single-source
 * top rank (~0.0164 — only dense OR keyword ranked this chunk first) and a
 * dual-source top rank (~0.0328 — both agree): a query where dense and
 * keyword retrieval don't agree on the top result is worth a second look,
 * even though something was technically retrieved.
 */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.02;

/** FR-7.10/11.9 substrate: low-confidence retrievals as a worklist, not yet clustered. */
export async function getCoverageGaps(db: Database.Database, tenant: TenantContext, options: { thresholdScore?: number; since?: string } = {}): Promise<CoverageGap[]> {
  const threshold = options.thresholdScore ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  return (await new KbRetrievalLogRepository(db, tenant).listLowConfidence(threshold, options.since)).map((e) => ({
    queryText: e.queryText,
    bestScore: e.bestScore,
    retrievedDocIds: e.retrievedDocIds,
    createdAt: e.createdAt,
  }));
}
