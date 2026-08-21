import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 2 M6a: A/B testing of agent versions — a new table, so no rebuild needed. */
export const migration010AgentExperiments: Migration = {
  id: "010_agent_experiments",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_experiments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        agent_key TEXT NOT NULL,
        variant_a_version INTEGER NOT NULL,
        variant_b_version INTEGER NOT NULL,
        traffic_split REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_experiments_tenant ON agent_experiments(tenant_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_experiments_one_active ON agent_experiments(tenant_id, agent_key) WHERE status = 'active';
    `);
  },
};
