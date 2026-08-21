import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 4 M4: embeddable web widgets. Deliberately NOT versioned with
 * agent_defs (which is append-only so running conversations keep the
 * prompt/tool config they started with) — colors/copy/logo should update
 * live for an embed the moment an admin saves, the same reasoning
 * agent_defs explicitly does NOT apply to itself. public_key is the only
 * thing an embed script exposes; see src/platform/widget-context.ts for
 * why it's a separate minted id rather than reusing agent_defs.key.
 */
export const migration017WidgetConfigs: Migration = {
  id: "017_widget_configs",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS widget_configs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        agent_key TEXT NOT NULL,
        public_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT 'Support',
        greeting_text TEXT NOT NULL DEFAULT '',
        primary_color TEXT NOT NULL DEFAULT '#3454d1',
        logo_url TEXT,
        position TEXT NOT NULL DEFAULT 'bottom-right',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, agent_key)
      );
      CREATE INDEX IF NOT EXISTS idx_widget_configs_public_key ON widget_configs(public_key);
    `);
  },
};
