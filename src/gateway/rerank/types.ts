/**
 * A1: cross-encoder rerank stage, an abstraction alongside the embedding
 * provider (src/gateway/embeddings/) — an interface, a real implementation,
 * and a deterministic stub for tests. A reranker sees the query and each
 * candidate chunk together and scores their relevance, which RRF (rank-only
 * fusion) cannot. Opt-in per agent via agent_defs.kb_scope.rerank; when the
 * configured reranker is unavailable, retrieval degrades to the un-reranked
 * RRF order rather than failing the turn.
 */
export interface RerankProvider {
  readonly provider: string;
  readonly model: string;
  /**
   * Returns one relevance score per document, aligned to the input order.
   * Higher is more relevant. The caller sorts and truncates — the provider
   * never reorders or drops entries itself.
   */
  rerank(query: string, documents: string[]): Promise<number[]>;
}
