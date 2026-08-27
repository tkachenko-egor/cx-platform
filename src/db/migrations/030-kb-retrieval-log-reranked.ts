import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * A1: records whether the cross-encoder rerank stage actually reordered a
 * given retrieval, so the effect of enabling it per agent is measurable in
 * production alongside the existing best_score column. Same additive shape
 * as migration 027 — default 0 (not reranked), so every existing row and
 * every agent that hasn't opted in is unaffected.
 */
export const migration030KbRetrievalLogReranked: Migration = {
  id: "030_kb_retrieval_log_reranked",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(kb_retrieval_log)`).all() as { name: string }[];
    if (columns.some((c) => c.name === "reranked")) return;
    db.exec(`ALTER TABLE kb_retrieval_log ADD COLUMN reranked INTEGER NOT NULL DEFAULT 0`);
  },
};
