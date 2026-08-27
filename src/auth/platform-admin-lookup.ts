import { cookies } from "next/headers";
import type Database from "better-sqlite3";
import { rowToUser, type User, type UserRow } from "../db/repositories/user-repository";
import { TenantRepository, type Tenant } from "../db/repositories/tenant-repository";
import { hashToken } from "./token-hash";
import { SESSION_COOKIE } from "./session";

/**
 * Phase 3 M4: the one deliberate, explicitly-named cross-tenant exception in
 * this codebase — same spirit as the in-memory session store or the naive
 * SLA elapsed-time math (both documented simplifications elsewhere). A
 * platform admin is an elevated `owner` (users.is_platform_admin) who needs
 * to be found WITHOUT knowing which tenant they belong to — that's the
 * entire point of these two functions, so they run raw, unscoped queries
 * rather than going through TenantScopedRepository. Fine at expected
 * small-staff platform-admin scale; not a pattern to copy elsewhere — every
 * other cross-tenant-shaped need in this codebase should go through
 * TenantScopedRepository as normal.
 */
export async function findPlatformAdminUserByEmail(db: Database.Database, email: string): Promise<{ user: User; tenant: Tenant } | undefined> {
  const row = db.prepare(`SELECT * FROM users WHERE email = ? AND is_platform_admin = 1`).get(email) as UserRow | undefined;
  if (!row) return undefined;
  const user = rowToUser(row);
  const tenant = await new TenantRepository(db).getById(user.tenantId);
  return tenant ? { user, tenant } : undefined;
}

export async function findPlatformAdminSessionByTokenHash(db: Database.Database, tokenHash: string): Promise<{ user: User; tenant: Tenant } | undefined> {
  const session = db.prepare(`SELECT user_id, tenant_id, expires_at FROM sessions WHERE token_hash = ?`).get(tokenHash) as
    | { user_id: string; tenant_id: string; expires_at: string }
    | undefined;
  if (!session || session.expires_at < new Date().toISOString()) return undefined;

  const row = db.prepare(`SELECT * FROM users WHERE id = ? AND tenant_id = ? AND is_platform_admin = 1`).get(session.user_id, session.tenant_id) as UserRow | undefined;
  if (!row) return undefined;
  const user = rowToUser(row);
  if (user.status !== "active") return undefined;

  const tenant = await new TenantRepository(db).getById(user.tenantId);
  return tenant ? { user, tenant } : undefined;
}

/** Reads the same cx_session cookie createSession() sets, resolved across tenants. Safe from Server Components and Route Handlers alike. */
export async function getPlatformAdminSessionUser(db: Database.Database): Promise<{ user: User; tenant: Tenant } | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  return await findPlatformAdminSessionByTokenHash(db, hashToken(token));
}
