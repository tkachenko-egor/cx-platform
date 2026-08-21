import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 6 M3/M5: two independent per-agent additions bundled into one
 * migration since both are small additive columns on agent_defs landing in
 * the same pass — native_tools carries OpenAI native-hosted-tool config
 * (web_search/file_search/mcp, only meaningful when the agent's model
 * resolves to the openai provider); quick_replies is an admin-authored list
 * of canned reply chips shown at the start of a conversation.
 */
export const migration019AgentNativeToolsAndQuickReplies: Migration = {
  id: "019_agent_native_tools_and_quick_replies",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(agent_defs)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "native_tools")) {
      db.exec(`ALTER TABLE agent_defs ADD COLUMN native_tools TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!columns.some((c) => c.name === "quick_replies")) {
      db.exec(`ALTER TABLE agent_defs ADD COLUMN quick_replies TEXT NOT NULL DEFAULT '[]'`);
    }
  },
};
