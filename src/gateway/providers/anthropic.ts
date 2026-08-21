import Anthropic from "@anthropic-ai/sdk";
import { GatewayError, type ChatRequest, type ChatResponse, type ProviderAdapter, type ToolCallRequest } from "../types";

/**
 * The only file in this codebase allowed to import "@anthropic-ai/sdk"
 * (enforced by eslint.config.mjs). Everything on the other side of `chat()`
 * only ever sees the canonical ChatRequest/ChatResponse shape.
 */
export class AnthropicProvider implements ProviderAdapter {
  readonly provider = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(model: string, request: ChatRequest): Promise<ChatResponse> {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = request.messages
      .filter((m): m is ChatRequest["messages"][number] & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const response = await this.client.messages.create({
        model,
        system: system || undefined,
        messages,
        max_tokens: request.maxOutputTokens ?? 1024,
        temperature: request.temperature,
        stop_sequences: request.stopSequences,
        tools: request.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input_schema: tool.parameters as any,
        })),
      });

      const toolCalls: ToolCallRequest[] = response.content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        }));

      const content = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      return {
        content,
        toolCalls,
        stopReason: mapStopReason(response.stop_reason),
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          cachedTokens: response.usage.cache_read_input_tokens ?? 0,
          costUsd: 0, // cost-per-model lookup is deferred past Phase 0
        },
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}

function mapStopReason(reason: string | null): ChatResponse["stopReason"] {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

function mapError(err: unknown): GatewayError {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return new GatewayError("RateLimited", err.message, err);
    if (err.status === 400 && /context|too long/i.test(err.message)) {
      return new GatewayError("ContextTooLong", err.message, err);
    }
    if (err.status === 400) return new GatewayError("InvalidRequest", err.message, err);
    if (typeof err.status === "number" && err.status >= 500) {
      return new GatewayError("ProviderUnavailable", err.message, err);
    }
    return new GatewayError("InvalidRequest", err.message, err);
  }
  return new GatewayError("ProviderUnavailable", err instanceof Error ? err.message : String(err), err);
}
