import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface Session {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

function rowToSession(row: SessionRow): Session {
  return { id: row.id, tenantId: row.tenant_id, userId: row.user_id, tokenHash: row.token_hash, expiresAt: row.expires_at, createdAt: row.created_at };
}

/** Server-side session records — only a hash of the session token is ever stored (see src/auth/session.ts). */
export class SessionRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  create(input: { userId: string; tokenHash: string; expiresAt: string }): Session {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, this.tenantId, input.userId, input.tokenHash, input.expiresAt, now);
    return { id, tenantId: this.tenantId, userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, createdAt: now };
  }

  getByTokenHash(tokenHash: string): Session | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE tenant_id = ? AND token_hash = ?`).get(this.tenantId, tokenHash) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  deleteByTokenHash(tokenHash: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE tenant_id = ? AND token_hash = ?`).run(this.tenantId, tokenHash);
  }
}
