import type { Migration } from "../migrate";

/**
 * B2: `kb_chunks.embedding` `jsonb` → pgvector `vector`. Dense retrieval
 * ordering leaves JS (the `cosineSimilarity` full scan in `hybridSearch`) and
 * moves into SQL — `KbChunkRepository.nearest()` ranks with `embedding <=> $1`.
 *
 * The column is left *unsized* (`vector`, not `vector(N)`): the embedding
 * dimension is provider-dependent — 32 for the deterministic test stub, 1536
 * for OpenAI `text-embedding-3-small` — and pgvector's HNSW / IVFFlat indexes
 * need a fixed typmod, so a baked-in N would break one deployment or the other.
 * At the current corpus size an exact `<=>` KNN scan is both correct (no ANN
 * recall loss) and faster than the prior full-table JS scan. A deployment that
 * has locked its embedding model can add an ANN index in a follow-up migration:
 *
 *   CREATE INDEX idx_kb_chunks_embedding ON kb_chunks
 *     USING hnsw ((embedding::vector(1536)) vector_cosine_ops);
 *
 * Idempotent: the ALTER only fires while the column is still `jsonb`. The
 * `jsonb → text → vector` cast chain relies on a jsonb array rendering as
 * `[1,2,3]`, which is exactly pgvector's text input format.
 */
const SQL = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kb_chunks' AND column_name = 'embedding' AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE kb_chunks ALTER COLUMN embedding TYPE vector USING embedding::text::vector;
  END IF;
END $$;
`;

export const migration001PgvectorKbChunksEmbedding: Migration = {
  id: "001-pgvector-kb-chunks-embedding",
  async up(db) {
    await db.exec(SQL);
  },
};
