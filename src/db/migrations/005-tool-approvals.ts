import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** FR-8.5/8.6: write-tool approval workflow + idempotency on tool_calls. */
export const migration005ToolApprovals: Migration = {
  id: "005_tool_approvals",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(tool_calls)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "idempotency_key")) {
      db.exec(`ALTER TABLE tool_calls ADD COLUMN idempotency_key TEXT`);
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_idempotency ON tool_calls(tenant_id, tool_key, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS tool_approvals (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        run_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        tool_key TEXT NOT NULL,
        arguments TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        policy TEXT NOT NULL CHECK (policy IN ('confirm_with_customer','require_human_approval')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
        decided_by TEXT REFERENCES users(id),
        decided_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (tenant_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_approvals_tenant ON tool_approvals(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tool_approvals_conversation ON tool_approvals(conversation_id);
    `);
  },
};
