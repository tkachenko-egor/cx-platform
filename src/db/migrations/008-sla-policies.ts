import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 2 M4: SLA engine — a new table, so no rebuild needed. */
export const migration008SlaPolicies: Migration = {
  id: "008_sla_policies",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sla_policies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
        target_minutes INTEGER NOT NULL,
        applies_to_channel TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant ON sla_policies(tenant_id);
    `);
  },
};
