import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 7 M1-M3: agent_defs gains admin-facing identity/lifecycle fields
 * (display_name, avatar, owner, tags, status, environment, change notes),
 * the remaining per-agent model controls (temperature, max output tokens,
 * a per-conversation cost ceiling), and two JSON-blob config columns for
 * persona/voice and language settings — same convention as the existing
 * guardrails/kb_scope/native_tools JSON columns.
 *
 * Defaults are chosen so every already-published row keeps behaving exactly
 * as it does today: agent_status='active' (still routable), environment=
 * 'production' (write tools still execute for real). Only agents created
 * *after* this migration default to 'draft'/'sandbox' via the create API
 * route, not via the column default itself.
 */
export const migration022AgentIdentityPersonaLanguage: Migration = {
  id: "022_agent_identity_persona_language",
  up(db: Database.Database) {
    const addColumnIfMissing = (table: string, column: string, ddl: string) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (columns.some((c) => c.name === column)) return;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };

    addColumnIfMissing("agent_defs", "display_name", `display_name TEXT NOT NULL DEFAULT ''`);
    addColumnIfMissing("agent_defs", "avatar_url", `avatar_url TEXT`);
    addColumnIfMissing("agent_defs", "internal_description", `internal_description TEXT NOT NULL DEFAULT ''`);
    addColumnIfMissing("agent_defs", "owner_user_id", `owner_user_id TEXT REFERENCES users(id)`);
    addColumnIfMissing("agent_defs", "tags", `tags TEXT NOT NULL DEFAULT '[]'`);
    addColumnIfMissing("agent_defs", "agent_status", `agent_status TEXT NOT NULL DEFAULT 'active' CHECK (agent_status IN ('draft','active','paused','archived'))`);
    addColumnIfMissing("agent_defs", "environment", `environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production'))`);
    addColumnIfMissing("agent_defs", "change_notes", `change_notes TEXT NOT NULL DEFAULT ''`);

    addColumnIfMissing("agent_defs", "temperature", `temperature REAL`);
    addColumnIfMissing("agent_defs", "max_output_tokens", `max_output_tokens INTEGER`);
    addColumnIfMissing("agent_defs", "cost_ceiling_usd", `cost_ceiling_usd REAL`);

    addColumnIfMissing("agent_defs", "persona", `persona TEXT NOT NULL DEFAULT '{}'`);
    addColumnIfMissing("agent_defs", "language_config", `language_config TEXT NOT NULL DEFAULT '{}'`);
  },
};
