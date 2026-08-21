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
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: "active" | "disabled";
  skills: string;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    skills: JSON.parse(row.skills) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** FR-2.1/2.2: staff identity. Not to be confused with FR-2.3's end-customer identity. */
export class UserRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  create(input: { email: string; passwordHash: string; role: Role; skills?: string[] }): User {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, role, status, skills, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.email, input.passwordHash, input.role, JSON.stringify(input.skills ?? []), now, now);
    return { id, tenantId: this.tenantId, email: input.email, passwordHash: input.passwordHash, role: input.role, status: "active", skills: input.skills ?? [], createdAt: now, updatedAt: now };
  }

  get(id: string): User | undefined {
    const row = this.db.prepare(`SELECT * FROM users WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  getByEmail(email: string): User | undefined {
    const row = this.db.prepare(`SELECT * FROM users WHERE tenant_id = ? AND email = ?`).get(this.tenantId, email) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  list(): User[] {
    const rows = this.db.prepare(`SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at ASC`).all(this.tenantId) as UserRow[];
    return rows.map(rowToUser);
  }
}
