import type { EmbeddingProvider } from "./types";

const DIMENSIONS = 32;

/** Zero-network, deterministic embeddings for tests/local dev (NFR-9.5). Not semantically meaningful — just stable per input string. */
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "stub";
  readonly model = "stub-embed";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.hashVector(text));
  }

  private hashVector(text: string): number[] {
    const vec = new Array<number>(DIMENSIONS).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % DIMENSIONS] += text.charCodeAt(i);
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}
