import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 8 M1/M3: two independent additions bundled into one migration, same
 * precedent as migration 022 — escalation_config is a small additive column
 * on agent_defs (per-agent keyword/threshold overrides, appended to the
 * hardcoded defaults in src/agents/escalation.ts, never replacing them), and
 * agent_publish_approvals is a new queued-review table modeled directly on
 * tool_approvals/review_queue: a supervisor's attempt to publish an agent
 * live (status=active AND environment=production) lands here instead of
 * publishing immediately, until an admin/owner approves or rejects it.
 */
export const migration023EscalationConfigAndPublishApprovals: Migration = {
  id: "023_escalation_config_and_publish_approvals",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(agent_defs)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "escalation_config")) {
      db.exec(`ALTER TABLE agent_defs ADD COLUMN escalation_config TEXT NOT NULL DEFAULT '{}'`);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_publish_approvals (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        agent_key TEXT NOT NULL,
        requested_version INTEGER NOT NULL,
        requested_by TEXT NOT NULL REFERENCES users(id),
        payload TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        from_environment TEXT NOT NULL,
        to_environment TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        decided_by TEXT REFERENCES users(id),
        decided_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_publish_approvals_tenant ON agent_publish_approvals(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_agent_publish_approvals_tenant_status ON agent_publish_approvals(tenant_id, status);
    `);
  },
};
