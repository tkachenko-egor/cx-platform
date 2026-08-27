import type { Migration } from "../migrate";

/**
 * B6: the model-continuity session store moves out of process memory
 * (`src/agents/sessions-store.ts`'s `Map`) into a table, so a multi-instance
 * deployment can serve alternating turns of one conversation (NFR-3.1). This
 * is the model's own replay history (full gateway-shape `tool_use` /
 * `tool_result` blocks) — the customer/desk transcript is still
 * `MessageRepository`.
 *
 * All three payload columns carry defaults so the two independent writers —
 * the channel turn (`history` / `turn_count`) and the agent runtime
 * (`consecutive_tool_failures`) — can each upsert only their own columns
 * without clobbering the other.
 *
 * RLS: migration 003's `information_schema` loop already ran, so this new
 * `tenant_id` table needs its own `tenant_isolation` policy + `cx_tenant`
 * grant here (003's `ALTER DEFAULT PRIVILEGES` also covers the grant, but be
 * explicit). Idempotent throughout.
 */
const SQL = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  turn_count integer NOT NULL DEFAULT 0,
  consecutive_tool_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions(updated_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_sessions TO cx_tenant;

ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_sessions;
CREATE POLICY tenant_isolation ON agent_sessions
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    nullif(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)
  );
`;

export const migration004AgentSessions: Migration = {
  id: "004-agent-sessions",
  async up(db) {
    await db.exec(SQL);
  },
};
