import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Per-agent tool configuration, keyed by tool key — the mechanism that keeps
 * the built-in commerce tools generic: return-window days, currency,
 * cancellable statuses and so on are agent config, not constants in
 * src/tools/commerce/. Same additive JSON-column shape as escalation_config
 * (migration 023); an empty object means "every tool uses its own defaults",
 * so existing agents are unaffected.
 */
export const migration027AgentToolSettings: Migration = {
  id: "027_agent_tool_settings",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(agent_defs)`).all() as { name: string }[];
    if (columns.some((c) => c.name === "tool_settings")) return;
    db.exec(`ALTER TABLE agent_defs ADD COLUMN tool_settings TEXT NOT NULL DEFAULT '{}'`);
  },
};
