import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 3 M2: staff invite + password-reset token tables — new tables, no rebuild needed. */
export const migration012UserInvitesAndPasswordResets: Migration = {
  id: "012_user_invites_and_password_resets",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_invites (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','supervisor','agent','viewer')),
        token_hash TEXT NOT NULL UNIQUE,
        invited_by TEXT REFERENCES users(id),
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_invites_tenant ON user_invites(tenant_id);

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_tenant ON password_reset_tokens(tenant_id);
    `);
  },
};
