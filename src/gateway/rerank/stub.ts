import type { RerankProvider } from "./types";

const TOKEN = /[\p{L}\p{N}]+/gu;

function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(TOKEN) ?? []));
}

/**
 * Zero-network, deterministic reranker for tests/local dev (NFR-9.5). Scores
 * a document by how many distinct query tokens it contains, normalised by
 * the query's token count — not semantically meaningful, just a stable,
 * query-aware ordering that differs from rank-only fusion.
 */
export class StubRerankProvider implements RerankProvider {
  readonly provider = "stub";
  readonly model = "stub-rerank";

  async rerank(query: string, documents: string[]): Promise<number[]> {
    const queryTokens = [...tokenize(query)];
    if (queryTokens.length === 0) return documents.map(() => 0);
    return documents.map((doc) => {
      const docTokens = tokenize(doc);
      const overlap = queryTokens.filter((t) => docTokens.has(t)).length;
      return overlap / queryTokens.length;
    });
  }
}
