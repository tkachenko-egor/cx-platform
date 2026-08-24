import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 9 (final agent-creation-checklist phase): bundles several small
 * additive changes, same precedent as migrations 022/023 —
 *   - agent_defs.conversation_config: in/out-of-scope topics, required
 *     slots, memory scope, custom prompt variables (src/agents/system-prompt.ts)
 *   - agent_defs.enabled_channels: per-agent channel allowlist, empty = all
 *     (src/channel/turn.ts's ensureConversation)
 *   - tenants.business_hours: weekly schedule (src/core/business-hours.ts)
 *   - tenants.alert_thresholds: analytics alert config (src/analytics/alerts.ts)
 *   - widget_configs.audience_rules: URL-pattern widget targeting
 *   - message_feedback: thumbs up/down per bot message
 *   - auto_tag_rules: keyword -> tag mappings (src/channel/turn.ts)
 */
export const migration024ConversationChannelsFeedbackTagging: Migration = {
  id: "024_conversation_channels_feedback_tagging",
  up(db: Database.Database) {
    const addColumnIfMissing = (table: string, column: string, ddl: string) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (columns.some((c) => c.name === column)) return;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };

    addColumnIfMissing("agent_defs", "conversation_config", `conversation_config TEXT NOT NULL DEFAULT '{}'`);
    addColumnIfMissing("agent_defs", "enabled_channels", `enabled_channels TEXT NOT NULL DEFAULT '[]'`);
    addColumnIfMissing("tenants", "business_hours", `business_hours TEXT NOT NULL DEFAULT '{}'`);
    addColumnIfMissing("tenants", "alert_thresholds", `alert_thresholds TEXT NOT NULL DEFAULT '{}'`);
    addColumnIfMissing("widget_configs", "audience_rules", `audience_rules TEXT NOT NULL DEFAULT '{}'`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS message_feedback (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('up','down')),
        comment TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (tenant_id, message_id)
      );

      CREATE INDEX IF NOT EXISTS idx_message_feedback_tenant ON message_feedback(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_message_feedback_conversation ON message_feedback(conversation_id);

      CREATE TABLE IF NOT EXISTS auto_tag_rules (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        tag TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_tenant ON auto_tag_rules(tenant_id);
    `);
  },
};
