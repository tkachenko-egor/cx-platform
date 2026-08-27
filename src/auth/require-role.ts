import type { Tenant } from "../db/repositories/tenant-repository";
import type { SqlDatabase } from "../db/pg";
import type { User } from "../db/repositories/user-repository";
import { getSessionUser } from "./session";
import { roleAtLeast, type Role } from "./permissions";

export class AuthError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.status = status;
  }
}

/** Throws AuthError (never returns undefined) — callers in Route Handlers catch it and map to a JSON error response. */
export async function requireRole(db: SqlDatabase, tenant: Tenant, minRole: Role): Promise<User> {
  const user = await getSessionUser(db, tenant);
  if (!user) throw new AuthError(401, "Authentication required");
  if (!roleAtLeast(user.role, minRole)) throw new AuthError(403, "Insufficient role");
  return user;
}
