import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Widget appearance customization: a font-family picker and separate background colors
 * for bot vs. user message bubbles (previously only a single `primary_color`, used just
 * for the launcher/composer, not the message bubbles themselves — see
 * components/chat/MessageBubble.tsx). Defaults are chosen to match today's hardcoded look
 * (`user_bubble_color` = the existing hardcoded --color-fg, `font_family` = the existing
 * Inter default) except `bot_bubble_color`, which introduces a new subtle bubble where bot
 * messages previously had none.
 */
export const migration021WidgetThemeFields: Migration = {
  id: "021_widget_theme_fields",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(widget_configs)`).all() as { name: string }[];
    const names = new Set(columns.map((c) => c.name));
    if (!names.has("font_family")) {
      db.exec(`ALTER TABLE widget_configs ADD COLUMN font_family TEXT NOT NULL DEFAULT 'inter'`);
    }
    if (!names.has("user_bubble_color")) {
      db.exec(`ALTER TABLE widget_configs ADD COLUMN user_bubble_color TEXT NOT NULL DEFAULT '#13141a'`);
    }
    if (!names.has("bot_bubble_color")) {
      db.exec(`ALTER TABLE widget_configs ADD COLUMN bot_bubble_color TEXT NOT NULL DEFAULT '#f1f2f6'`);
    }
  },
};
