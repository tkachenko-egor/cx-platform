import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { Role } from "../../auth/permissions";

export interface UserInvite {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  tokenHash: string;
  invitedBy: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

interface UserInviteRow {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  token_hash: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

function rowToInvite(row: UserInviteRow): UserInvite {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    tokenHash: row.token_hash,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}

/** Phase 3 M2: staff invite tokens — a pending invite is just a token row, `users` is only written to at acceptance. */
export class UserInviteRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: { email: string; role: Role; tokenHash: string; invitedBy: string | null; expiresAt: string }): Promise<UserInvite> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_invites (id, tenant_id, email, role, token_hash, invited_by, expires_at, accepted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(id, this.tenantId, input.email, input.role, input.tokenHash, input.invitedBy, input.expiresAt, now);
    return { id, tenantId: this.tenantId, email: input.email, role: input.role, tokenHash: input.tokenHash, invitedBy: input.invitedBy, expiresAt: input.expiresAt, acceptedAt: null, createdAt: now };
  }

  async getByTokenHash(tokenHash: string): Promise<UserInvite | undefined> {
    const row = this.db.prepare(`SELECT * FROM user_invites WHERE tenant_id = ? AND token_hash = ?`).get(this.tenantId, tokenHash) as UserInviteRow | undefined;
    return row ? rowToInvite(row) : undefined;
  }

  async markAccepted(id: string): Promise<void> {
    this.db.prepare(`UPDATE user_invites SET accepted_at = ? WHERE tenant_id = ? AND id = ?`).run(new Date().toISOString(), this.tenantId, id);
  }

  async listPending(): Promise<UserInvite[]> {
    const rows = this.db
      .prepare(`SELECT * FROM user_invites WHERE tenant_id = ? AND accepted_at IS NULL ORDER BY created_at DESC`)
      .all(this.tenantId) as UserInviteRow[];
    return rows.map(rowToInvite);
  }
}
