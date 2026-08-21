import { GatewayError, type ChatRequest, type ChatResponse, type ChatUsage, type NativeToolConfig, type ProviderAdapter, type ToolCallRequest } from "../types";

const ENDPOINT = "https://api.openai.com/v1/responses";

/**
 * Illustrative per-million-token USD rates (input / output / cached-input),
 * same convention as AnthropicProvider's PRICING_PER_MILLION_USD — update
 * from OpenAI's current pricing page.
 */
const PRICING_PER_MILLION_USD: Record<string, { input: number; output: number; cachedInput: number }> = {
  "gpt-5.1": { input: 2.5, output: 10, cachedInput: 0.25 },
  "gpt-5.1-mini": { input: 0.4, output: 1.6, cachedInput: 0.04 },
  "gpt-5.1-nano": { input: 0.1, output: 0.4, cachedInput: 0.01 },
};
const DEFAULT_PRICING = { input: 2.5, output: 10, cachedInput: 0.25 };

function estimateCostUsd(model: string, usage: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } }): number {
  const rates = PRICING_PER_MILLION_USD[model] ?? DEFAULT_PRICING;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncachedInput = Math.max(0, usage.input_tokens - cached);
  const cost = (uncachedInput * rates.input + cached * rates.cachedInput + usage.output_tokens * rates.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// --- Responses API item shapes (only the fields this adapter reads/writes) ---
interface ResponsesInputItem {
  type: "message" | "function_call" | "function_call_output";
  role?: "system" | "user" | "assistant";
  content?: { type: string; text: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

interface ResponsesOutputItem {
  type: string;
  role?: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ResponsesApiResponse {
  output: ResponsesOutputItem[];
  status?: "completed" | "incomplete" | "failed";
  incomplete_details?: { reason?: string };
  usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } };
}

/**
 * Raw fetch against OpenAI's Responses API — same no-SDK convention as
 * src/gateway/embeddings/openai.ts, so this stays a single thin adapter
 * file rather than pulling in another vendor package. The Responses API
 * (rather than Chat Completions) is what supports OpenAI's native hosted
 * tools (web_search/file_search/mcp) — see ChatRequest.nativeTools.
 */
export class OpenAiProvider implements ProviderAdapter {
  readonly provider = "openai";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(model: string, request: ChatRequest): Promise<ChatResponse> {
    const res = await this.call(model, request, false);
    const body = (await res.json()) as ResponsesApiResponse;
    return this.toChatResponse(model, body);
  }

  async chatStream(model: string, request: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse> {
    const res = await this.call(model, request, true);
    if (!res.body) return this.chat(model, request);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: ResponsesApiResponse | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          onDelta(event.delta);
        } else if (event.type === "response.completed") {
          final = (event.response ?? undefined) as ResponsesApiResponse | undefined;
        }
      }
    }

    if (!final) throw new GatewayError("ProviderUnavailable", "OpenAI stream ended without a completed response");
    return this.toChatResponse(model, final);
  }

  private async call(model: string, request: ChatRequest, stream: boolean): Promise<Response> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        instructions: this.buildInstructions(request),
        input: this.toResponsesInput(request.messages),
        tools: this.buildTools(request),
        max_output_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream,
      }),
    });
    if (!res.ok) throw await this.mapError(res);
    return res;
  }

  private buildInstructions(request: ChatRequest): string | undefined {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    return system || undefined;
  }

  private toResponsesInput(messages: ChatRequest["messages"]): ResponsesInputItem[] {
    const items: ResponsesInputItem[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "user") {
        items.push({ type: "message", role: "user", content: [{ type: "input_text", text: m.content }] });
      } else if (m.role === "assistant") {
        if (m.content) items.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: m.content }] });
        for (const call of m.toolCalls ?? []) {
          items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
        }
      } else if (m.role === "tool") {
        items.push({ type: "function_call_output", call_id: m.toolCallId ?? "", output: m.content });
      }
    }
    return items;
  }

  private buildTools(request: ChatRequest): Record<string, unknown>[] {
    const functionTools = (request.tools ?? []).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    const native = (request.nativeTools ?? []).map((nt) => this.toResponsesTool(nt));
    return [...functionTools, ...native];
  }

  private toResponsesTool(nt: NativeToolConfig): Record<string, unknown> {
    switch (nt.type) {
      case "web_search":
        return { type: "web_search" };
      case "file_search":
        return { type: "file_search", vector_store_ids: nt.vectorStoreIds };
      case "mcp":
        return { type: "mcp", server_label: nt.serverLabel, server_url: nt.serverUrl, headers: nt.headers, require_approval: "never" };
    }
  }

  private toChatResponse(model: string, response: ResponsesApiResponse): ChatResponse {
    const toolCalls: ToolCallRequest[] = response.output
      .filter((item) => item.type === "function_call")
      .map((item) => ({ id: item.call_id ?? "", name: item.name ?? "", arguments: safeParseArgs(item.arguments) }));

    const content = response.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === "output_text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("");

    const usage: ChatUsage = {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      costUsd: response.usage ? estimateCostUsd(model, response.usage) : 0,
    };

    let stopReason: ChatResponse["stopReason"] = "end_turn";
    if (toolCalls.length > 0) stopReason = "tool_use";
    else if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") stopReason = "max_tokens";

    return { content, toolCalls, stopReason, usage };
  }

  private async mapError(res: Response): Promise<GatewayError> {
    const detail = await res.text().catch(() => "");
    if (res.status === 429) return new GatewayError("RateLimited", `OpenAI rate limited: ${detail}`);
    if (res.status === 400 && /context length|maximum context/i.test(detail)) return new GatewayError("ContextTooLong", `OpenAI context too long: ${detail}`);
    if (res.status === 400) return new GatewayError("InvalidRequest", `OpenAI request failed: ${detail}`);
    if (res.status >= 500) return new GatewayError("ProviderUnavailable", `OpenAI unavailable: ${detail}`);
    return new GatewayError("InvalidRequest", `OpenAI request failed (${res.status}): ${detail}`);
  }
}

function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
