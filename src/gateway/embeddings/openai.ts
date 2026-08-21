import { GatewayError } from "../types";
import type { EmbeddingProvider } from "./types";

const ENDPOINT = "https://api.openai.com/v1/embeddings";

interface OpenAiEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Raw fetch against OpenAI's REST endpoint — no SDK dependency, so this
 * stays a single thin adapter file rather than pulling in another vendor
 * package. OPENAI_API_KEY is only ever read here.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openai";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 429) throw new GatewayError("RateLimited", `OpenAI embeddings rate limited: ${detail}`);
      if (res.status >= 500) throw new GatewayError("ProviderUnavailable", `OpenAI embeddings unavailable: ${detail}`);
      throw new GatewayError("InvalidRequest", `OpenAI embeddings request failed (${res.status}): ${detail}`);
    }

    const body = (await res.json()) as OpenAiEmbeddingResponse;
    return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
