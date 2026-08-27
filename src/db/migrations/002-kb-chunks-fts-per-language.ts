import type { Migration } from "../migrate";

/**
 * B3: the keyword half of retrieval becomes per-agent-language. B1 shipped a
 * `kb_chunks.fts` column generated as `to_tsvector('english', text)` — but the
 * language is an agent property (`agent_defs.language_config`), and one KB
 * collection feeds agents in different languages, so a single stored tsvector
 * can't be right for all of them.
 *
 * The stored column goes; `KbChunkRepository.searchKeyword` now computes
 * `to_tsvector(<config>, text)` at query time (config resolved from the agent's
 * language by `src/kb/text-search-config.ts`). A GIN expression index on the
 * `'english'` form keeps the common / default path index-backed; other
 * languages do an on-the-fly tsvector scan, which is fine at this corpus size.
 *
 * Idempotent: guarded on `IF EXISTS` / `IF NOT EXISTS`.
 */
const SQL = `
DROP INDEX IF EXISTS idx_kb_chunks_fts;
ALTER TABLE kb_chunks DROP COLUMN IF EXISTS fts;
CREATE INDEX IF NOT EXISTS idx_kb_chunks_fts_english ON kb_chunks USING gin (to_tsvector('english', text));
`;

export const migration002KbChunksFtsPerLanguage: Migration = {
  id: "002-kb-chunks-fts-per-language",
  async up(db) {
    await db.exec(SQL);
  },
};
