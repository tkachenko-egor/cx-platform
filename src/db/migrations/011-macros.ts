import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 2 M8: canned-response macros for the desk composer — a new table, so no rebuild needed. */
export const migration011Macros: Migration = {
  id: "011_macros",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS macros (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_by TEXT REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_macros_tenant ON macros(tenant_id);
    `);
  },
};
