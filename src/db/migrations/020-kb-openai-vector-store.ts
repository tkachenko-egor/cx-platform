import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Phase 6 M3: backing columns for OpenAI File Search sync — a collection
 * gets a vector store lazily provisioned the first time an agent turns on
 * File Search against it (src/kb/openai-vector-store-sync.ts), and each
 * article tracks the OpenAI file id it was uploaded as so edits/deletes can
 * target the right remote file. Both nullable: most collections never opt
 * into File Search and stay untouched.
 */
export const migration020KbOpenaiVectorStore: Migration = {
  id: "020_kb_openai_vector_store",
  up(db: Database.Database) {
    const collectionColumns = db.prepare(`PRAGMA table_info(kb_collections)`).all() as { name: string }[];
    if (!collectionColumns.some((c) => c.name === "openai_vector_store_id")) {
      db.exec(`ALTER TABLE kb_collections ADD COLUMN openai_vector_store_id TEXT`);
    }

    const articleColumns = db.prepare(`PRAGMA table_info(kb_articles)`).all() as { name: string }[];
    if (!articleColumns.some((c) => c.name === "openai_file_id")) {
      db.exec(`ALTER TABLE kb_articles ADD COLUMN openai_file_id TEXT`);
    }
  },
};
