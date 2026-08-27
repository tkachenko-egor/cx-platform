import type { RerankProvider } from "./types";
import { HttpRerankProvider } from "./http";

export type { RerankProvider } from "./types";
export { HttpRerankProvider } from "./http";
export { StubRerankProvider } from "./stub";

/**
 * The rerank sidecar is infrastructure config, not a per-tenant credential —
 * one URL for the deployment, read from RERANKER_URL here and nowhere else.
 * Unset (every test, and any deploy without a sidecar) → undefined, and
 * hybridSearch() falls back to the un-reranked RRF order. Whether a given
 * agent actually reranks is still gated by agent_defs.kb_scope.rerank.
 */
export function getRerankProvider(): RerankProvider | undefined {
  const url = process.env.RERANKER_URL;
  if (!url) return undefined;
  return new HttpRerankProvider(url, process.env.RERANKER_MODEL || undefined);
}
