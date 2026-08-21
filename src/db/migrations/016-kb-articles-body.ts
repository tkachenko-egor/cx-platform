import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 4 M3: admin-authored KB articles. Before this, kb_articles only
 * ever stored metadata + a content hash — the actual markdown lived in
 * knowledge/*.md files on disk, read by scripts/ingest-kb.ts. An
 * admin-created article has no file, so its body has to live in the DB.
 * Note: an article that DOES come from a file is still re-synced from
 * disk on the next `npm run seed`/ingest run (by doc_id, comparing
 * content_hash) — editing a file-sourced article from the admin UI will
 * be overwritten by its file's content on the next ingest. Fine for this
 * milestone: file-based docs stay file-managed, admin-created docs stay
 * admin-managed.
 */
export const migration016KbArticlesBody: Migration = {
  id: "016_kb_articles_body",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(kb_articles)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === "body")) {
      db.exec(`ALTER TABLE kb_articles ADD COLUMN body TEXT NOT NULL DEFAULT ''`);
    }
  },
};
