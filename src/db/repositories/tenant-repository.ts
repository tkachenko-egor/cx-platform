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
interface TenantRow {
  id: string;
  name: string;
  slug: string;
}

function rowToTenant(row: TenantRow): Tenant {
  return { ...row, tenantId: row.id };
}

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
    const row = this.db.prepare(`SELECT id, name, slug FROM tenants WHERE slug = ?`).get(slug) as TenantRow | undefined;
    return row ? rowToTenant(row) : undefined;
  }

  getById(id: string): Tenant | undefined {
    const row = this.db.prepare(`SELECT id, name, slug FROM tenants WHERE id = ?`).get(id) as TenantRow | undefined;
    return row ? rowToTenant(row) : undefined;
  }

  list(): Tenant[] {
    const rows = this.db.prepare(`SELECT id, name, slug FROM tenants ORDER BY name`).all() as TenantRow[];
    return rows.map(rowToTenant);
  }

  update(id: string, input: { name?: string; slug?: string }): Tenant {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Tenant ${id} not found`);
    const name = input.name ?? existing.name;
    const slug = input.slug ?? existing.slug;
    this.db.prepare(`UPDATE tenants SET name = ?, slug = ?, updated_at = ? WHERE id = ?`).run(name, slug, new Date().toISOString(), id);
    return { id, tenantId: id, name, slug };
  }
}
