import Anthropic from "@anthropic-ai/sdk";
import { GatewayError, type ChatRequest, type ChatResponse, type ChatUsage, type ProviderAdapter, type ToolCallRequest } from "../types";

/**
 * Illustrative per-million-token USD rates (input / output / cached-input).
 * Update from Anthropic's current pricing page — these exist so cost_usd is
 * a real computed number (FR-5.10) instead of the Phase 0 placeholder 0.
 */
const PRICING_PER_MILLION_USD: Record<string, { input: number; output: number; cachedInput: number }> = {
  "claude-sonnet-5": { input: 3, output: 15, cachedInput: 0.3 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4, cachedInput: 0.08 },
};
const DEFAULT_PRICING = { input: 3, output: 15, cachedInput: 0.3 };

function estimateCostUsd(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }): number {
  const rates = PRICING_PER_MILLION_USD[model] ?? DEFAULT_PRICING;
  const cached = usage.cache_read_input_tokens ?? 0;
  const uncachedInput = Math.max(0, usage.input_tokens - cached);
  const cost = (uncachedInput * rates.input + cached * rates.cachedInput + usage.output_tokens * rates.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

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
    try {
      const response = await this.client.messages.create({
        model,
        ...this.buildParams(request),
      });
      return this.toChatResponse(model, response);
    } catch (err) {
      throw mapError(err);
    }
  }

  async chatStream(model: string, request: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse> {
    try {
      const stream = this.client.messages.stream({
        model,
        ...this.buildParams(request),
      });
      stream.on("text", (delta) => onDelta(delta));
      const response = await stream.finalMessage();
      return this.toChatResponse(model, response);
    } catch (err) {
      throw mapError(err);
    }
  }

  private buildParams(request: ChatRequest) {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = this.toAnthropicMessages(request.messages.filter((m) => m.role !== "system"));

    return {
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
    };
  }

  /**
   * Reconstructs Anthropic's tool_use/tool_result content-block shape from
   * the canonical (provider-agnostic) message list: an assistant message's
   * `toolCalls` become tool_use blocks, and consecutive role:"tool"
   * entries become tool_result blocks batched into one user message —
   * Anthropic requires tool results to arrive as a user turn.
   */
  private toAnthropicMessages(messages: ChatRequest["messages"]): Anthropic.Messages.MessageParam[] {
    const result: Anthropic.Messages.MessageParam[] = [];
    let i = 0;
    while (i < messages.length) {
      const m = messages[i];
      if (m.role === "user") {
        result.push({ role: "user", content: m.content });
        i++;
      } else if (m.role === "assistant") {
        const blocks: Anthropic.Messages.ContentBlockParam[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const call of m.toolCalls ?? []) {
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
        }
        result.push({ role: "assistant", content: blocks });
        i++;
      } else if (m.role === "tool") {
        const toolResults: Anthropic.Messages.ContentBlockParam[] = [];
        while (i < messages.length && messages[i].role === "tool") {
          const t = messages[i];
          toolResults.push({ type: "tool_result", tool_use_id: t.toolCallId ?? "", content: t.content });
          i++;
        }
        result.push({ role: "user", content: toolResults });
      } else {
        i++;
      }
    }
    return result;
  }

  private toChatResponse(model: string, response: Anthropic.Messages.Message): ChatResponse {
    const toolCalls: ToolCallRequest[] = response.content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, arguments: block.input as Record<string, unknown> }));

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const usage: ChatUsage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      cachedTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsd: estimateCostUsd(model, response.usage),
    };

    return { content, toolCalls, stopReason: mapStopReason(response.stop_reason), usage };
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
