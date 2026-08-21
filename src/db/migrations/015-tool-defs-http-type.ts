import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 3 M7: admin-authored HTTP tools. `type` distinguishes REGISTRY-code
 * tools (unchanged) from 'http' tools whose request config lives in
 * handler_config (see src/tools/http-tool-executor.ts) instead of a code
 * handler — so a tenant admin can add a tool without a deploy.
 */
export const migration015ToolDefsHttpType: Migration = {
  id: "015_tool_defs_http_type",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(tool_defs)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "type")) {
      db.exec(`ALTER TABLE tool_defs ADD COLUMN type TEXT NOT NULL DEFAULT 'code'`);
    }
    if (!columns.some((c) => c.name === "handler_config")) {
      db.exec(`ALTER TABLE tool_defs ADD COLUMN handler_config TEXT NOT NULL DEFAULT '{}'`);
    }
  },
};
