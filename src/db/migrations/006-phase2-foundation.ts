import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 2 foundation: conversations gain priority/tags/sla_due_at, agent_defs and users gain skills, tenants gain a timezone — the substrate the rest of Phase 2 (SLA engine, skill-based routing, review queue) builds on. */
export const migration006Phase2Foundation: Migration = {
  id: "006_phase2_foundation",
  up(db: Database.Database) {
    const addColumnIfMissing = (table: string, column: string, ddl: string) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (columns.some((c) => c.name === column)) return;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };

    addColumnIfMissing("conversations", "priority", `priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'))`);
    addColumnIfMissing("conversations", "tags", `tags TEXT NOT NULL DEFAULT '[]'`);
    addColumnIfMissing("conversations", "sla_due_at", `sla_due_at TEXT`);
    addColumnIfMissing("agent_defs", "skills", `skills TEXT NOT NULL DEFAULT '[]'`);
    addColumnIfMissing("users", "skills", `skills TEXT NOT NULL DEFAULT '[]'`);
    addColumnIfMissing("tenants", "timezone", `timezone TEXT NOT NULL DEFAULT 'UTC'`);
  },
};
