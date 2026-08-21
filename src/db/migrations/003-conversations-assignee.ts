import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Adds conversations.assignee_id for desk assignment, once staff users exist (migration 002). */
export const migration003ConversationsAssignee: Migration = {
  id: "003_conversations_assignee",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(conversations)`).all() as { name: string }[];
    if (columns.some((c) => c.name === "assignee_id")) return;
    db.exec(`ALTER TABLE conversations ADD COLUMN assignee_id TEXT REFERENCES users(id)`);
  },
};
