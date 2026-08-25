import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import type { TenantContext } from "../tenancy/context";
import { KbArticleRepository, KbChunkRepository, type KbArticle, type KbChunk } from "../db/repositories/kb-repository";

export interface RetrievedChunk {
  chunk: KbChunk;
  article: KbArticle;
  score: number;
}

export interface KbScope {
  /** Audiences this agent may retrieve from. Defaults to ["customer"] — advisor-only docs stay out unless explicitly scoped in. Only consulted when collectionIds is empty/absent (legacy path, see hybridSearch). */
  audience?: string[];
  /** Phase 5 M1: which Knowledge Base collections this agent draws from. Takes priority over the audience filter when non-empty — new agents/edits go through this path, already-published agents (still {audience:[...]} only) keep working via the fallback. */
  collectionIds?: string[];
}

const RRF_K = 60;

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** FTS5 MATCH has its own query syntax — raw user text can contain characters that break it. Reduce to an OR of quoted word tokens. */
function toFtsQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

/**
 * FR-7.4: dense (cosine over kb_chunks.embedding) + keyword (FTS5) fused via
 * Reciprocal Rank Fusion. FR-7.6/7.7: honors kb_scope's filter before either
 * ranking runs — collectionIds when set (Phase 5 M1), else the legacy
 * audience filter, so already-published agents keep retrieving exactly as
 * before without a forced re-publish.
 */
export async function hybridSearch(db: Database.Database, tenant: TenantContext, kbScope: KbScope, query: string, limit: number, embeddings: EmbeddingProvider): Promise<RetrievedChunk[]> {
  const articleRepo = new KbArticleRepository(db, tenant);
  const chunkRepo = new KbChunkRepository(db, tenant);

  const articlesById = new Map(articleRepo.list().map((a) => [a.id, a]));

  // KB-01: `collectionIds` present-but-empty means the admin deliberately
  // deselected every KB — that must retrieve nothing, not fall back to the
  // legacy audience filter (which has no notion of "no access" and would
  // otherwise hand back every article, tenant-wide, tagged for the audience).
  // Only a genuinely *absent* collectionIds field (agents published before
  // Phase 5 M1, DB default '{}') takes the legacy path.
  const useCollections = Array.isArray(kbScope.collectionIds);
  const allowedCollectionIds = new Set(kbScope.collectionIds ?? []);
  const allowedAudiences = new Set(kbScope.audience ?? ["customer"]);

  const candidateChunks = chunkRepo.listByTenant().filter((c) => {
    const article = articlesById.get(c.articleId);
    if (!article) return false;
    return useCollections ? Boolean(article.collectionId && allowedCollectionIds.has(article.collectionId)) : allowedAudiences.has(article.audience);
  });
  if (candidateChunks.length === 0) return [];

  const [queryVector] = await embeddings.embed([query]);
  const denseRanked = [...candidateChunks].sort((a, b) => cosineSimilarity(b.embedding, queryVector) - cosineSimilarity(a.embedding, queryVector)).slice(0, 20);

  const ftsQuery = toFtsQuery(query);
  const keywordIds = ftsQuery ? chunkRepo.searchKeyword(ftsQuery, 20) : [];
  const allowedChunkIds = new Set(candidateChunks.map((c) => c.id));
  const keywordRanked = keywordIds.filter((id) => allowedChunkIds.has(id));

  const scores = new Map<string, number>();
  denseRanked.forEach((chunk, i) => {
    scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  keywordRanked.forEach((chunkId, i) => {
    scores.set(chunkId, (scores.get(chunkId) ?? 0) + 1 / (RRF_K + i + 1));
  });

  const chunkById = new Map(candidateChunks.map((c) => [c.id, c]));
  const fused = [...scores.entries()]
    .map(([chunkId, score]) => ({ chunk: chunkById.get(chunkId), score }))
    .filter((r): r is { chunk: KbChunk; score: number } => Boolean(r.chunk))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return fused.map(({ chunk, score }) => ({ chunk, article: articlesById.get(chunk.articleId)!, score }));
}
