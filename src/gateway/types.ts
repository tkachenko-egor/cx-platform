/**
 * FR-5.1: the canonical chat request/response shape. No provider SDK type
 * crosses this boundary in either direction — see eslint.config.mjs, which
 * enforces that at lint time.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** role: "tool" only — which tool_use this result responds to. */
  toolCallId?: string;
  toolName?: string;
  /** role: "assistant" only — tool calls this message made, so history replay can reconstruct them. */
  toolCalls?: ToolCallRequest[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Phase 6 M3: provider-hosted tools that execute server-side on the
 * provider's own infrastructure, as opposed to ToolDefinition entries
 * (which we execute ourselves via src/tools/registry.ts). Generic/vendor-
 * neutral shape — only OpenAiProvider currently reads this; other adapters
 * ignore it, so it's safe to populate unconditionally from agent config.
 */
export type NativeToolConfig =
  | { type: "web_search" }
  | { type: "file_search"; vectorStoreIds: string[] }
  | { type: "mcp"; serverLabel: string; serverUrl: string; headers?: Record<string, string> };

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  nativeTools?: NativeToolConfig[];
  maxOutputTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /** FR-5.10: single currency, always. */
  costUsd: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCallRequest[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: ChatUsage;
}

/** FR-5.8: normalised error taxonomy across providers. */
export type GatewayErrorType =
  | "RateLimited"
  | "ContextTooLong"
  | "ContentFiltered"
  | "Timeout"
  | "InvalidRequest"
  | "ProviderUnavailable";

export class GatewayError extends Error {
  readonly type: GatewayErrorType;
  readonly cause?: unknown;

  constructor(type: GatewayErrorType, message: string, cause?: unknown) {
    super(message);
    this.name = "GatewayError";
    this.type = type;
    this.cause = cause;
  }
}

/** FR-5.3: the runtime reads this and adapts — it never assumes. */
export interface ModelCapabilities {
  toolCalling: boolean;
  parallelToolCalls: boolean;
  structuredOutput: boolean;
  vision: boolean;
  streaming: boolean;
  extendedReasoning: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ProviderAdapter {
  readonly provider: string;
  chat(model: string, request: ChatRequest): Promise<ChatResponse>;
  /**
   * FR-3.2/NFR-1.1: token-by-token streaming. Optional because not every
   * provider adapter needs to implement it — ModelGateway.chatStream()
   * falls back to chat() (and a single synthetic delta) when absent.
   */
  chatStream?(model: string, request: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse>;
}
