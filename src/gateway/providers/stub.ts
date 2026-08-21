import type { ChatRequest, ChatResponse, ProviderAdapter } from "../types";

/**
 * Zero-network, deterministic provider for local dev and tests
 * (NFR-9.5 — the full stack must run without cloud dependencies).
 * Also doubles as the second provider proving FR-5.2's "at least two
 * adapters to prove the abstraction" — paired with the Anthropic adapter.
 */
export class StubProvider implements ProviderAdapter {
  readonly provider = "stub";

  async chat(model: string, request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      content: `[stub:${model}] echo: ${lastUser?.content ?? ""}`,
      toolCalls: [],
      stopReason: "end_turn",
      usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
    };
  }
}
