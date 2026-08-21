import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Migration } from "../migrate";

/**
 * Phase 5 M1: introduces named, reusable Knowledge Base collections —
 * before this, kb_articles was a flat per-tenant list with only a loose
 * `audience` string for grouping. An agent now picks which collection(s)
 * it draws from (many-to-many via agent_defs.kb_scope.collectionIds, no
 * new column there — it's a JSON blob already).
 *
 * Every pre-existing article (in particular the file-sourced ones from
 * knowledge/*.md, which predate this table entirely) gets backfilled into
 * a "General" collection per tenant so nothing ends up uncategorized —
 * see src/kb/retrieval.ts's audience-filter fallback for why this doesn't
 * also require re-publishing every agent that already references KB
 * content by audience.
 */
export const migration018KbCollections: Migration = {
  id: "018_kb_collections",
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_collections (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_collections_tenant ON kb_collections(tenant_id);
    `);

    const columns = db.prepare(`PRAGMA table_info(kb_articles)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "collection_id")) {
      db.exec(`ALTER TABLE kb_articles ADD COLUMN collection_id TEXT REFERENCES kb_collections(id)`);
    }

    const tenantsNeedingBackfill = db.prepare(`SELECT DISTINCT tenant_id FROM kb_articles WHERE collection_id IS NULL`).all() as { tenant_id: string }[];
    const now = new Date().toISOString();
    for (const { tenant_id } of tenantsNeedingBackfill) {
      const collectionId = randomUUID();
      db.prepare(
        `INSERT INTO kb_collections (id, tenant_id, name, description, created_at, updated_at) VALUES (?, ?, 'General', 'Default collection for articles that existed before Knowledge Bases were introduced.', ?, ?)`,
      ).run(collectionId, tenant_id, now, now);
      db.prepare(`UPDATE kb_articles SET collection_id = ? WHERE tenant_id = ? AND collection_id IS NULL`).run(collectionId, tenant_id);
    }
  },
};
