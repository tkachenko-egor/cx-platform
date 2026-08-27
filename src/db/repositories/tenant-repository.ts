import { randomUUID } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
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
  timezone: string;
  /** Phase 9: weekly schedule — see src/core/business-hours.ts. */
  businessHours: BusinessHoursConfig;
  /** Phase 9: analytics alert config — see src/analytics/alerts.ts. */
  alertThresholds: AlertThresholdsConfig;
}

export interface WeeklyHoursRule {
  /** 0 = Sunday, matching Date#getDay(). */
  day: number;
  start: string;
  end: string;
}

export interface BusinessHoursConfig {
  enabled?: boolean;
  weeklyHours?: WeeklyHoursRule[];
}

export interface AlertThresholdsConfig {
  maxHandoffRatePct?: number;
  minCsatScore?: number;
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
  timezone: string;
  business_hours: string;
  alert_thresholds: string;
}

const TENANT_COLUMNS = "id, name, slug, timezone, business_hours, alert_thresholds";

function rowToTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    tenantId: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    businessHours: fromJson<BusinessHoursConfig>(row.business_hours),
    alertThresholds: fromJson<AlertThresholdsConfig>(row.alert_thresholds),
  };
}

export class TenantRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(name: string, slug: string): Promise<Tenant> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(`INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, name, slug, now, now);
    return { id, tenantId: id, name, slug, timezone: "UTC", businessHours: {}, alertThresholds: {} };
  }

  async getBySlug(slug: string): Promise<Tenant | undefined> {
    const row = await this.db.prepare(`SELECT ${TENANT_COLUMNS} FROM tenants WHERE slug = ?`).get(slug) as TenantRow | undefined;
    return row ? rowToTenant(row) : undefined;
  }

  async getById(id: string): Promise<Tenant | undefined> {
    const row = await this.db.prepare(`SELECT ${TENANT_COLUMNS} FROM tenants WHERE id = ?`).get(id) as TenantRow | undefined;
    return row ? rowToTenant(row) : undefined;
  }

  async list(): Promise<Tenant[]> {
    const rows = await this.db.prepare(`SELECT ${TENANT_COLUMNS} FROM tenants ORDER BY name`).all() as TenantRow[];
    return rows.map(rowToTenant);
  }

  async update(id: string, input: { name?: string; slug?: string }): Promise<Tenant> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Tenant ${id} not found`);
    const name = input.name ?? existing.name;
    const slug = input.slug ?? existing.slug;
    await this.db.prepare(`UPDATE tenants SET name = ?, slug = ?, updated_at = ? WHERE id = ?`).run(name, slug, new Date().toISOString(), id);
    return { ...existing, name, slug };
  }

  /** Phase 9: admin-facing business-hours editor (app/admin/business-hours/page.tsx). */
  async updateBusinessHours(id: string, config: BusinessHoursConfig): Promise<void> {
    await this.db.prepare(`UPDATE tenants SET business_hours = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(config), new Date().toISOString(), id);
  }

  /** Phase 9: admin-facing alert-threshold editor on /analytics. */
  async updateAlertThresholds(id: string, config: AlertThresholdsConfig): Promise<void> {
    await this.db.prepare(`UPDATE tenants SET alert_thresholds = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(config), new Date().toISOString(), id);
  }
}
