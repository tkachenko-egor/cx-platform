import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Tools get an admin-facing name; `key` becomes a derived, immutable
 * identifier (src/core/slugify.ts) rather than something an admin hand-types.
 * Existing rows backfill their key as the display name so nothing renders
 * blank before an admin edits them.
 */
export const migration028ToolDefDisplayName: Migration = {
  id: "028_tool_def_display_name",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(tool_defs)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "display_name")) {
      db.exec(`ALTER TABLE tool_defs ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`);
    }
    db.exec(`UPDATE tool_defs SET display_name = key WHERE display_name = ''`);
  },
};
