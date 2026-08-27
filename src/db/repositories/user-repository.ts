import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { Role } from "../../auth/permissions";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: "active" | "disabled";
  /** Phase 2 M6b: capability tags matched against conversations.tags for assignee suggestions (src/desk/skill-match.ts). */
  skills: string[];
  /** Phase 3 M4: an elevated owner who can also administer tenants platform-wide (src/auth/platform-admin-lookup.ts). */
  isPlatformAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: "active" | "disabled";
  skills: string;
  is_platform_admin: number;
  created_at: string;
  updated_at: string;
}

/** Exported so src/auth/platform-admin-lookup.ts's cross-tenant query can map rows the same way, without duplicating the shape. */
export function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    skills: JSON.parse(row.skills) as string[],
    isPlatformAdmin: Boolean(row.is_platform_admin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** FR-2.1/2.2: staff identity. Not to be confused with FR-2.3's end-customer identity. */
export class UserRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: { email: string; passwordHash: string; role: Role; skills?: string[] }): Promise<User> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, role, status, skills, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.email, input.passwordHash, input.role, JSON.stringify(input.skills ?? []), now, now);
    return { id, tenantId: this.tenantId, email: input.email, passwordHash: input.passwordHash, role: input.role, status: "active", skills: input.skills ?? [], isPlatformAdmin: false, createdAt: now, updatedAt: now };
  }

  async get(id: string): Promise<User | undefined> {
    const row = this.db.prepare(`SELECT * FROM users WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  async getByEmail(email: string): Promise<User | undefined> {
    const row = this.db.prepare(`SELECT * FROM users WHERE tenant_id = ? AND email = ?`).get(this.tenantId, email) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  async list(): Promise<User[]> {
    const rows = this.db.prepare(`SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at ASC`).all(this.tenantId) as UserRow[];
    return rows.map(rowToUser);
  }

  /** Phase 3 M2: password reset. */
  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    this.db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(passwordHash, new Date().toISOString(), this.tenantId, id);
  }

  /** Phase 3 M3: team management — role reassignment / deactivation. WHERE tenant_id = ? AND id = ? throughout, matching get()'s scoping. */
  async update(id: string, input: { role?: Role; status?: "active" | "disabled"; skills?: string[] }): Promise<User | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const role = input.role ?? existing.role;
    const status = input.status ?? existing.status;
    const skills = input.skills ?? existing.skills;
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE users SET role = ?, status = ?, skills = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(role, status, JSON.stringify(skills), now, this.tenantId, id);
    return { ...existing, role, status, skills, updatedAt: now };
  }

  /** Phase 3 M4: grant/revoke platform-admin (tenant management crossing tenant boundaries — see src/auth/platform-admin-lookup.ts). */
  async setPlatformAdmin(id: string, value: boolean): Promise<void> {
    this.db.prepare(`UPDATE users SET is_platform_admin = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(value ? 1 : 0, new Date().toISOString(), this.tenantId, id);
  }
}
