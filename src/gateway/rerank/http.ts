import { GatewayError } from "../types";
import type { RerankProvider } from "./types";

/**
 * Raw fetch against a rerank sidecar (bge-reranker-v2-m3 behind a small
 * HTTP wrapper, a FlashRank server, or a HF text-embeddings-inference
 * `/rerank` endpoint) — no SDK dependency, same thin-adapter shape as
 * OpenAiEmbeddingProvider. The sidecar URL is the only configuration and is
 * read once, by getRerankProvider() in ./index.ts.
 *
 * Request:  POST <url>  { "query": string, "documents": string[] }
 * Response: either { "scores": number[] } aligned to the input order, or a
 *           TEI-style array [{ "index": number, "score": number }, ...].
 */
export class HttpRerankProvider implements RerankProvider {
  readonly provider = "http";
  readonly model: string;
  private readonly url: string;

  constructor(url: string, model = "bge-reranker-v2-m3") {
    this.url = url;
    this.model = model;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    if (documents.length === 0) return [];

    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, documents, model: this.model }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 429) throw new GatewayError("RateLimited", `Reranker rate limited: ${detail}`);
      if (res.status >= 500) throw new GatewayError("ProviderUnavailable", `Reranker unavailable: ${detail}`);
      throw new GatewayError("InvalidRequest", `Reranker request failed (${res.status}): ${detail}`);
    }

    const body = (await res.json()) as { scores?: number[] } | { index: number; score: number }[];

    if (Array.isArray(body)) {
      const scores = new Array<number>(documents.length).fill(0);
      for (const entry of body) {
        if (entry.index >= 0 && entry.index < documents.length) scores[entry.index] = entry.score;
      }
      return scores;
    }

    if (Array.isArray(body.scores) && body.scores.length === documents.length) {
      return body.scores;
    }

    throw new GatewayError("InvalidRequest", `Reranker response shape unrecognised (expected { scores: number[] } of length ${documents.length} or [{ index, score }])`);
  }
}
