import { redirect } from "next/navigation";
import type Database from "better-sqlite3";
import type { Tenant } from "../db/repositories/tenant-repository";
import { getSessionUser } from "./session";
import { roleAtLeast } from "./permissions";

/**
 * Phase 8 M3: app/admin/layout.tsx now admits supervisor+ (so the
 * agent-editing pages under app/admin/agents/** are reachable), but several
 * admin pages — team, api-keys, audit-log, experiments, kb, models, tools —
 * are still admin/owner-only. Call this at the top of those pages; a
 * supervisor gets redirected to the one area they do have access to instead
 * of a raw 403.
 */
export async function requireAdminPage(db: Database.Database, tenant: Tenant): Promise<void> {
  const user = (await getSessionUser(db, tenant))!; // app/admin/layout.tsx already guarantees a session exists
  if (!roleAtLeast(user.role, "admin")) redirect("/admin/agents");
}
