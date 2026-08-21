import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
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
  };
}

/** FR-7.1/7.2: articles + their content hash (so re-ingest only re-embeds changed chunks). */
export class KbArticleRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  upsert(input: { docId: string; title: string; audience: string; effective: string | null; contentHash: string; body?: string; collectionId?: string | null }): KbArticle {
    const existing = this.getByDocId(input.docId);
    const now = new Date().toISOString();
    const body = input.body ?? existing?.body ?? "";
    const collectionId = input.collectionId !== undefined ? input.collectionId : (existing?.collectionId ?? null);
    if (existing) {
      this.db
        .prepare(
          `UPDATE kb_articles SET title = ?, audience = ?, effective = ?, content_hash = ?, body = ?, collection_id = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(input.title, input.audience, input.effective, input.contentHash, body, collectionId, now, existing.id, this.tenantId);
      return { ...existing, ...input, body, collectionId };
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO kb_articles (id, tenant_id, doc_id, title, audience, effective, content_hash, body, collection_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.docId, input.title, input.audience, input.effective, input.contentHash, body, collectionId, now, now);
    return { id, tenantId: this.tenantId, ...input, body, collectionId };
  }

  getByDocId(docId: string): KbArticle | undefined {
    const row = this.db
      .prepare(`SELECT * FROM kb_articles WHERE tenant_id = ? AND doc_id = ?`)
      .get(this.tenantId, docId) as KbArticleRow | undefined;
    return row ? rowToArticle(row) : undefined;
  }

  list(filter?: { collectionId?: string }): KbArticle[] {
    const rows = filter?.collectionId
      ? (this.db.prepare(`SELECT * FROM kb_articles WHERE tenant_id = ? AND collection_id = ?`).all(this.tenantId, filter.collectionId) as KbArticleRow[])
      : (this.db.prepare(`SELECT * FROM kb_articles WHERE tenant_id = ?`).all(this.tenantId) as KbArticleRow[]);
    return rows.map(rowToArticle);
  }

  /** Phase 4 M3 admin UI: deleting an article's row; its chunks are cleaned up by the caller via KbChunkRepository. */
  delete(docId: string): void {
    this.db.prepare(`DELETE FROM kb_articles WHERE tenant_id = ? AND doc_id = ?`).run(this.tenantId, docId);
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
  embedding: string;
  embedding_model: string;
  token_count: number;
}

function rowToChunk(row: KbChunkRow): KbChunk {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    articleId: row.article_id,
    ordinal: row.ordinal,
    heading: row.heading,
    text: row.text,
    embedding: JSON.parse(row.embedding) as number[],
    embeddingModel: row.embedding_model,
    tokenCount: row.token_count,
  };
}

/** FR-7 chunk storage + the FTS5 keyword index kept in lockstep with it. */
export class KbChunkRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  replaceForArticle(articleId: string, chunks: Array<Omit<KbChunk, "id" | "tenantId" | "articleId">>): void {
    const deleteExisting = this.db.transaction(() => {
      const existingIds = (
        this.db.prepare(`SELECT id FROM kb_chunks WHERE tenant_id = ? AND article_id = ?`).all(this.tenantId, articleId) as {
          id: string;
        }[]
      ).map((r) => r.id);
      for (const id of existingIds) {
        this.db.prepare(`DELETE FROM kb_chunks_fts WHERE chunk_id = ?`).run(id);
      }
      this.db.prepare(`DELETE FROM kb_chunks WHERE tenant_id = ? AND article_id = ?`).run(this.tenantId, articleId);

      for (const chunk of chunks) {
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO kb_chunks (id, tenant_id, article_id, ordinal, heading, text, embedding, embedding_model, token_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, this.tenantId, articleId, chunk.ordinal, chunk.heading, chunk.text, JSON.stringify(chunk.embedding), chunk.embeddingModel, chunk.tokenCount);
        this.db.prepare(`INSERT INTO kb_chunks_fts (chunk_id, tenant_id, text) VALUES (?, ?, ?)`).run(id, this.tenantId, chunk.text);
      }
    });
    deleteExisting();
  }

  listByTenant(): KbChunk[] {
    const rows = this.db.prepare(`SELECT * FROM kb_chunks WHERE tenant_id = ?`).all(this.tenantId) as KbChunkRow[];
    return rows.map(rowToChunk);
  }

  getByIds(ids: string[]): KbChunk[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM kb_chunks WHERE tenant_id = ? AND id IN (${placeholders})`)
      .all(this.tenantId, ...ids) as KbChunkRow[];
    return rows.map(rowToChunk);
  }

  searchKeyword(query: string, limit: number): string[] {
    const rows = this.db
      .prepare(`SELECT chunk_id FROM kb_chunks_fts WHERE tenant_id = ? AND kb_chunks_fts MATCH ? ORDER BY rank LIMIT ?`)
      .all(this.tenantId, query, limit) as { chunk_id: string }[];
    return rows.map((r) => r.chunk_id);
  }
}
