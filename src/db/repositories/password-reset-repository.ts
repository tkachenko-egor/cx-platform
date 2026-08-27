import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface PasswordResetToken {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

interface PasswordResetTokenRow {
  id: string;
  tenant_id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

function rowToToken(row: PasswordResetTokenRow): PasswordResetToken {
  return { id: row.id, tenantId: row.tenant_id, userId: row.user_id, tokenHash: row.token_hash, expiresAt: row.expires_at, usedAt: row.used_at, createdAt: row.created_at };
}

/** Phase 3 M2: password-reset tokens, same shape as UserInviteRepository. */
export class PasswordResetRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: { userId: string; tokenHash: string; expiresAt: string }): Promise<PasswordResetToken> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(`INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`)
      .run(id, this.tenantId, input.userId, input.tokenHash, input.expiresAt, now);
    return { id, tenantId: this.tenantId, userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, usedAt: null, createdAt: now };
  }

  async getByTokenHash(tokenHash: string): Promise<PasswordResetToken | undefined> {
    const row = await this.db.prepare(`SELECT * FROM password_reset_tokens WHERE tenant_id = ? AND token_hash = ?`).get(this.tenantId, tokenHash) as PasswordResetTokenRow | undefined;
    return row ? rowToToken(row) : undefined;
  }

  async markUsed(id: string): Promise<void> {
    await this.db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE tenant_id = ? AND id = ?`).run(new Date().toISOString(), this.tenantId, id);
  }
}
