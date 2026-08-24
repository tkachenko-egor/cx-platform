import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Per-agent business-hours override (admin UI batch, item 1): an agent can
 * now set its own weekly schedule instead of always inheriting the
 * tenant-wide default added in migration 024. NULL means "inherit the
 * tenant default" — zero behavior change for every existing agent, since
 * src/channel/turn.ts falls back to tenant.businessHours whenever this is
 * null. Same BusinessHoursConfig JSON shape as tenants.business_hours,
 * just nullable instead of NOT NULL DEFAULT '{}' (an agent needs a
 * three-state distinction — "no override", "override: always open",
 * "override: this schedule" — that tenants.business_hours never needed).
 */
export const migration025AgentBusinessHoursOverride: Migration = {
  id: "025_agent_business_hours_override",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(agent_defs)`).all() as { name: string }[];
    if (columns.some((c) => c.name === "business_hours")) return;
    db.exec(`ALTER TABLE agent_defs ADD COLUMN business_hours TEXT`);
  },
};
