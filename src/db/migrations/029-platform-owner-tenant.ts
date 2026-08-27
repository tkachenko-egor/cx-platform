import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

interface AdminUserRow {
  id: string;
  tenant_id: string;
  email: string;
}

/**
 * The platform owner shouldn't be an elevated user inside a demo/mock
 * tenant — it belongs to its own reserved "platform" tenant (slug
 * "platform", already excluded from ordinary tenant resolution by
 * src/platform/reserved-subdomains.ts). This only backfills existing
 * is_platform_admin=1 users into that tenant; a fresh DB with no
 * platform-admin users yet gets no "platform" tenant row at all here —
 * scripts/seed.ts is what creates one going forward, on demand, so this
 * migration stays a no-op (and every existing test's tenant list
 * unaffected) until there's actually something to migrate.
 */
export const migration029PlatformOwnerTenant: Migration = {
  id: "029_platform_owner_tenant",
  up(db: Database.Database) {
    const admins = db.prepare(`SELECT id, tenant_id, email FROM users WHERE is_platform_admin = 1`).all() as AdminUserRow[];
    if (admins.length === 0) return;

    let platform = db.prepare(`SELECT id FROM tenants WHERE slug = 'platform'`).get() as { id: string } | undefined;
    if (!platform) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (?, 'Platform', 'platform', ?, ?)`).run(id, now, now);
      platform = { id };
    }
    const platformTenantId = platform.id;

    for (const admin of admins) {
      if (admin.tenant_id === platformTenantId) continue;

      const collision = db.prepare(`SELECT 1 FROM users WHERE tenant_id = ? AND email = ?`).get(platformTenantId, admin.email);
      if (collision) {
        // Same email already present in the platform tenant — leave this row where it is rather than violate the (tenant_id, email) uniqueness constraint.
        continue;
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE users SET tenant_id = ?, updated_at = ? WHERE id = ?`).run(platformTenantId, now, admin.id);
      db.prepare(`UPDATE sessions SET tenant_id = ? WHERE user_id = ? AND tenant_id = ?`).run(platformTenantId, admin.id, admin.tenant_id);
    }
  },
};
