import type { ModelCapabilities } from "./types";

/**
 * FR-5.3. Keyed by "<provider>:<model>". Phase 0 ships enough entries to
 * exercise the lookup and the swap test; extend as real models get bound
 * to aliases.
 */
const CAPABILITY_MATRIX: Record<string, ModelCapabilities> = {
  "anthropic:claude-sonnet-5": {
    toolCalling: true,
    parallelToolCalls: true,
    structuredOutput: true,
    vision: true,
    streaming: true,
    extendedReasoning: true,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
  },
  "anthropic:claude-haiku-4-5-20251001": {
    toolCalling: true,
    parallelToolCalls: true,
    structuredOutput: true,
    vision: true,
    streaming: true,
    extendedReasoning: false,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
  },
  "stub:stub-a": {
    toolCalling: false,
    parallelToolCalls: false,
    structuredOutput: false,
    vision: false,
    streaming: false,
    extendedReasoning: false,
    contextWindow: 8_000,
    maxOutputTokens: 1_024,
  },
  "stub:stub-b": {
    toolCalling: false,
    parallelToolCalls: false,
    structuredOutput: false,
    vision: false,
    streaming: false,
    extendedReasoning: false,
    contextWindow: 8_000,
    maxOutputTokens: 1_024,
  },
};

export function getCapabilities(provider: string, model: string): ModelCapabilities | undefined {
  return CAPABILITY_MATRIX[`${provider}:${model}`];
}
