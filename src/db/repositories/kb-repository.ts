import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface KbArticle {
  id: string;
  tenantId: string;
  docId: string;
  title: string;
  audience: string;
  effective: string | null;
  contentHash: string;
  /** Phase 4 M3: only populated for admin-created articles — file-sourced ones keep their body on disk. */
  body: string;
  /** Phase 5 M1: which Knowledge Base this article belongs to — see kb-collection-repository.ts. */
  collectionId: string | null;
  /** Phase 6 M3: set only when this article's collection has File Search enabled — see src/kb/openai-vector-store-sync.ts. */
  openaiFileId: string | null;
}

interface KbArticleRow {
  id: string;
  tenant_id: string;
  doc_id: string;
  title: string;
  audience: string;
  effective: string | null;
  content_hash: string;
  body: string;
  collection_id: string | null;
  openai_file_id: string | null;
}

function rowToArticle(row: KbArticleRow): KbArticle {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    docId: row.doc_id,
    title: row.title,
    audience: row.audience,
    effective: row.effective,
    contentHash: row.content_hash,
    body: row.body,
    collectionId: row.collection_id,
    openaiFileId: row.openai_file_id,
  };
}

/** FR-7.1/7.2: articles + their content hash (so re-ingest only re-embeds changed chunks). */
export class KbArticleRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async upsert(input: { docId: string; title: string; audience: string; effective: string | null; contentHash: string; body?: string; collectionId?: string | null }): Promise<KbArticle> {
    const existing = await this.getByDocId(input.docId);
    const now = new Date().toISOString();
    const body = input.body ?? existing?.body ?? "";
    const collectionId = input.collectionId !== undefined ? input.collectionId : (existing?.collectionId ?? null);
    if (existing) {
      await this.db
        .prepare(
          `UPDATE kb_articles SET title = ?, audience = ?, effective = ?, content_hash = ?, body = ?, collection_id = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(input.title, input.audience, input.effective, input.contentHash, body, collectionId, now, existing.id, this.tenantId);
      return { ...existing, ...input, body, collectionId };
    }
    const id = randomUUID();
    await this.db
      .prepare(
        `INSERT INTO kb_articles (id, tenant_id, doc_id, title, audience, effective, content_hash, body, collection_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.docId, input.title, input.audience, input.effective, input.contentHash, body, collectionId, now, now);
    return { id, tenantId: this.tenantId, ...input, body, collectionId, openaiFileId: null };
  }

  /** Phase 6 M3: called by the vector-store sync helpers after uploading/re-uploading this article's file. */
  async setOpenAiFileId(docId: string, fileId: string | null): Promise<void> {
    await this.db.prepare(`UPDATE kb_articles SET openai_file_id = ? WHERE tenant_id = ? AND doc_id = ?`).run(fileId, this.tenantId, docId);
  }

  async getByDocId(docId: string): Promise<KbArticle | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM kb_articles WHERE tenant_id = ? AND doc_id = ?`)
      .get<KbArticleRow>(this.tenantId, docId);
    return row ? rowToArticle(row) : undefined;
  }

  async list(filter?: { collectionId?: string }): Promise<KbArticle[]> {
    const rows = filter?.collectionId
      ? await this.db.prepare(`SELECT * FROM kb_articles WHERE tenant_id = ? AND collection_id = ?`).all<KbArticleRow>(this.tenantId, filter.collectionId)
      : await this.db.prepare(`SELECT * FROM kb_articles WHERE tenant_id = ?`).all<KbArticleRow>(this.tenantId);
    return rows.map(rowToArticle);
  }

  /** Phase 4 M3 admin UI: deleting an article's row; its chunks are cleaned up by the caller via KbChunkRepository. */
  async delete(docId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM kb_articles WHERE tenant_id = ? AND doc_id = ?`).run(this.tenantId, docId);
  }
}

export interface KbChunk {
  id: string;
  tenantId: string;
  articleId: string;
  ordinal: number;
  heading: string | null;
  text: string;
  embedding: number[];
  embeddingModel: string;
  tokenCount: number;
}

interface KbChunkRow {
  id: string;
  tenant_id: string;
  article_id: string;
  ordinal: number;
  heading: string | null;
  text: string;
  embedding: string | number[];
  embedding_model: string;
  token_count: number;
}

/** B2: pgvector hands a `vector` column back as its text form (`'[1,2,3]'`), which is also valid JSON. Tolerates an already-parsed array too. */
function parseVector(v: string | number[]): number[] {
  return Array.isArray(v) ? v : (JSON.parse(v) as number[]);
}

function rowToChunk(row: KbChunkRow): KbChunk {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    articleId: row.article_id,
    ordinal: row.ordinal,
    heading: row.heading,
    text: row.text,
    embedding: parseVector(row.embedding),
    embeddingModel: row.embedding_model,
    tokenCount: row.token_count,
  };
}

/**
 * FR-7 chunk storage + the keyword index. B1: the fts5 sidecar table became a
 * `tsvector` generated column (`kb_chunks.fts`) with a GIN index — nothing to
 * maintain on write, and `searchKeyword` ranks with `ts_rank_cd`.
 */
export class KbChunkRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async replaceForArticle(articleId: string, chunks: Array<Omit<KbChunk, "id" | "tenantId" | "articleId">>): Promise<void> {
    await this.db.tx(async (q) => {
      await q.prepare(`DELETE FROM kb_chunks WHERE tenant_id = ? AND article_id = ?`).run(this.tenantId, articleId);
      for (const chunk of chunks) {
        await q
          .prepare(
            `INSERT INTO kb_chunks (id, tenant_id, article_id, ordinal, heading, text, embedding, embedding_model, token_count)
             VALUES (?, ?, ?, ?, ?, ?, ?::vector, ?, ?)`,
          )
          .run(randomUUID(), this.tenantId, articleId, chunk.ordinal, chunk.heading, chunk.text, JSON.stringify(chunk.embedding), chunk.embeddingModel, chunk.tokenCount);
      }
    });
  }

  async listByTenant(): Promise<KbChunk[]> {
    const rows = await this.db.prepare(`SELECT * FROM kb_chunks WHERE tenant_id = ?`).all<KbChunkRow>(this.tenantId);
    return rows.map(rowToChunk);
  }

  /** KB-04: the admin article list had no way to tell "is this article actually retrievable yet?" short of guessing questions at the test pane — surfaces the chunk count computed at import/save time instead. */
  async countByArticleIds(articleIds: string[]): Promise<Map<string, number>> {
    if (articleIds.length === 0) return new Map();
    const placeholders = articleIds.map(() => "?").join(",");
    const rows = await this.db
      .prepare(`SELECT article_id, COUNT(*) as count FROM kb_chunks WHERE tenant_id = ? AND article_id IN (${placeholders}) GROUP BY article_id`)
      .all<{ article_id: string; count: number }>(this.tenantId, ...articleIds);
    return new Map(rows.map((r) => [r.article_id, r.count]));
  }

  async getByIds(ids: string[]): Promise<KbChunk[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db
      .prepare(`SELECT * FROM kb_chunks WHERE tenant_id = ? AND id IN (${placeholders})`)
      .all<KbChunkRow>(this.tenantId, ...ids);
    return rows.map(rowToChunk);
  }

  /**
   * B2: dense (cosine) nearest-neighbour ranking, done in SQL over the pgvector
   * `embedding` column. `<=>` is cosine distance (`1 − cosine similarity`), so
   * ascending distance is descending similarity — the exact ordering the JS
   * `cosineSimilarity` sort in `hybridSearch` used to produce. Restricted to
   * `candidateChunkIds` so the kb_scope (collection / audience) filter still
   * runs before ranking, mirroring how `searchKeyword` returns ranked ids over
   * the same candidate set.
   */
  async nearest(queryVector: number[], limit: number, candidateChunkIds: string[]): Promise<string[]> {
    if (candidateChunkIds.length === 0) return [];
    const placeholders = candidateChunkIds.map(() => "?").join(",");
    const rows = await this.db
      .prepare(
        `SELECT id FROM kb_chunks
         WHERE tenant_id = ? AND id IN (${placeholders})
         ORDER BY embedding <=> ?::vector
         LIMIT ?`,
      )
      .all<{ id: string }>(this.tenantId, ...candidateChunkIds, JSON.stringify(queryVector), limit);
    return rows.map((r) => r.id);
  }

  async searchKeyword(query: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, ts_rank_cd(fts, websearch_to_tsquery('english', ?)) AS rank
         FROM kb_chunks
         WHERE tenant_id = ? AND fts @@ websearch_to_tsquery('english', ?)
         ORDER BY rank DESC
         LIMIT ?`,
      )
      .all<{ id: string }>(query, this.tenantId, query, limit);
    return rows.map((r) => r.id);
  }
}
