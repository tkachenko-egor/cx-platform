import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";

/**
 * A tenant row IS a TenantContext — `tenantId` mirrors `id` so callers can
 * pass a Tenant directly into any TenantScopedRepository constructor
 * without an adapter step.
 */
export interface Tenant extends TenantContext {
  id: string;
  name: string;
  slug: string;
}

/**
 * The one repository that is deliberately NOT tenant-scoped — tenants are
 * the scoping entity, so this is where tenant identity itself is minted
 * and looked up.
 */
export class TenantRepository {
  constructor(private readonly db: Database.Database) {}

  create(name: string, slug: string): Tenant {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, name, slug, now, now);
    return { id, tenantId: id, name, slug };
  }

  getBySlug(slug: string): Tenant | undefined {
    const row = this.db.prepare(`SELECT id, name, slug FROM tenants WHERE slug = ?`).get(slug) as
      | { id: string; name: string; slug: string }
      | undefined;
    return row ? { ...row, tenantId: row.id } : undefined;
  }
}
