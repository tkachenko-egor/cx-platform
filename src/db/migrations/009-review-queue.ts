import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 2 M5: human review queue — a new table, so no rebuild needed. */
export const migration009ReviewQueue: Migration = {
  id: "009_review_queue",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS review_queue (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        conversation_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_event_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
        reviewed_by TEXT REFERENCES users(id),
        reviewed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_queue_tenant ON review_queue(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_review_queue_tenant_status ON review_queue(tenant_id, status);
    `);
  },
};
