import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Staff RBAC/auth tables (FR-2.1/2.2/2.7). `schema.sql` already creates
 * these via CREATE TABLE IF NOT EXISTS for any fresh DB, so this migration
 * only does real work against a pre-existing DB file from before Phase 1b.
 */
export const migration002RbacAndAudit: Migration = {
  id: "002_rbac_and_audit",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','supervisor','agent','viewer')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        actor_user_id TEXT REFERENCES users(id),
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        before TEXT,
        after TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);
    `);
  },
};
