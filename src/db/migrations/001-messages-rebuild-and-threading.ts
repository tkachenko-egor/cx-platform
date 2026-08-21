import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Widens messages.role to match core/types.ts's MessageRole union (adds
 * tool_call/tool_result/handoff — needed by Phase 1b's router/handoff and
 * email/ticket work) and adds channel-threading columns. SQLite can't
 * ALTER a CHECK constraint, so this is a copy-rebuild-swap.
 */
export const migration001MessagesRebuildAndThreading: Migration = {
  id: "001_messages_rebuild_and_threading",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
    if (columns.some((c) => c.name === "channel_message_id")) return; // already this shape

    db.exec(`
      CREATE TABLE messages_new (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL CHECK (role IN ('user','assistant','agent_human','system','tool_call','tool_result','handoff','note')),
        content TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
        sequence INTEGER NOT NULL,
        channel_message_id TEXT,
        in_reply_to TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO messages_new (id, tenant_id, conversation_id, role, content, visibility, sequence, created_at)
        SELECT id, tenant_id, conversation_id, role, content, visibility, sequence, created_at FROM messages;

      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sequence);
    `);
  },
};
