/** FR-5.12: embedding provider abstraction, separate from the chat abstraction. */
export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}
