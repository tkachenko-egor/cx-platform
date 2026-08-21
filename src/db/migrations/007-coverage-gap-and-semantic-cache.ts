import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 2 M3a/M3b: coverage-gap logging + opt-in semantic caching. */
export const migration007CoverageGapAndSemanticCache: Migration = {
  id: "007_coverage_gap_and_semantic_cache",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(agent_defs)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "semantic_cache_enabled")) {
      db.exec(`ALTER TABLE agent_defs ADD COLUMN semantic_cache_enabled INTEGER NOT NULL DEFAULT 0`);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_retrieval_log (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        conversation_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        query_text TEXT NOT NULL,
        best_score REAL NOT NULL,
        retrieved_doc_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_retrieval_log_tenant ON kb_retrieval_log(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_kb_retrieval_log_tenant_score ON kb_retrieval_log(tenant_id, best_score);

      CREATE TABLE IF NOT EXISTS semantic_cache (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        agent_key TEXT NOT NULL,
        query_text TEXT NOT NULL,
        query_embedding TEXT NOT NULL,
        response_text TEXT NOT NULL,
        citable_docs TEXT NOT NULL DEFAULT '[]',
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_hit_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_cache_tenant_agent ON semantic_cache(tenant_id, agent_key);
    `);
  },
};
