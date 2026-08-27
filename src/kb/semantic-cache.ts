import type { EmbeddingProvider } from "../gateway/embeddings/types";
import type { SqlDatabase } from "../db/pg";
import type { TenantContext } from "../tenancy/context";
import { SemanticCacheRepository } from "../db/repositories/semantic-cache-repository";
import { cosineSimilarity } from "./retrieval";

/**
 * Conservative by design (see the Phase 2 plan's trim note): a wrong cached
 * answer looks exactly like a right one, so the bar for "close enough to
 * reuse" is high — 0.97 cosine similarity, well above what two merely
 * related questions would score.
 */
const SIMILARITY_THRESHOLD = 0.97;

export interface SemanticCacheHit {
  responseText: string;
  citableDocs: { docId: string; title: string }[];
}

export async function lookupCache(
  db: SqlDatabase,
  tenant: TenantContext,
  agentKey: string,
  queryText: string,
  embeddings: EmbeddingProvider,
): Promise<SemanticCacheHit | undefined> {
  const repo = new SemanticCacheRepository(db, tenant);
  const entries = await repo.listByAgent(agentKey);
  if (entries.length === 0) return undefined;

  const [queryVector] = await embeddings.embed([queryText]);
  let best: { id: string; responseText: string; citableDocs: { docId: string; title: string }[]; similarity: number } | undefined;
  for (const entry of entries) {
    const similarity = cosineSimilarity(entry.queryEmbedding, queryVector);
    if (!best || similarity > best.similarity) {
      best = { id: entry.id, responseText: entry.responseText, citableDocs: entry.citableDocs, similarity };
    }
  }
  if (!best || best.similarity < SIMILARITY_THRESHOLD) return undefined;

  await repo.recordHit(best.id);
  return { responseText: best.responseText, citableDocs: best.citableDocs };
}

export async function writeCache(
  db: SqlDatabase,
  tenant: TenantContext,
  agentKey: string,
  queryText: string,
  responseText: string,
  citableDocs: { docId: string; title: string }[],
  embeddings: EmbeddingProvider,
): Promise<void> {
  const [queryVector] = await embeddings.embed([queryText]);
  await new SemanticCacheRepository(db, tenant).record({ agentKey, queryText, queryEmbedding: queryVector, responseText, citableDocs });
}
