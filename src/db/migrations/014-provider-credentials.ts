import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Provider API keys, DB-backed and per-tenant instead of a single shared
 * process env var. `kind` distinguishes LLM provider keys (one active per
 * tenant+provider, resolved by src/platform/context.ts's buildContext) from
 * HTTP-tool integration credentials (many simultaneously active, addressed
 * by id from a tool's handler_config). Each row is attributed to the staff
 * user who added it (owner_user_id) for audit purposes.
 */
export const migration014ProviderCredentials: Migration = {
  id: "014_provider_credentials",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_credentials (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        kind TEXT NOT NULL CHECK (kind IN ('llm_provider','tool_integration')),
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        key_last4 TEXT NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        rotated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_provider_credentials_tenant ON provider_credentials(tenant_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_credentials_one_active_llm
        ON provider_credentials(tenant_id, provider) WHERE kind = 'llm_provider' AND is_active = 1;
    `);
  },
};
