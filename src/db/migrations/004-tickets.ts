import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** FR-3.17/3.18: ticket lifecycle for the email channel — a new table, so no rebuild needed. */
export const migration004Tickets: Migration = {
  id: "004_tickets",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        subject TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','pending_customer','pending_internal','resolved','closed')),
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
        category TEXT,
        assignee_id TEXT REFERENCES users(id),
        due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets(tenant_id, status);
    `);
  },
};
