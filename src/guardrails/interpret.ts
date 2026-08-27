import type { ChatRequest } from "../gateway/types";
import type { AgentGuardrailConfig } from "./types";

const SET_GUARDRAILS_TOOL = "set_guardrails";

const SYSTEM_PROMPT = `You convert an admin's plain-language description of guardrails into this platform's structured guardrail config by calling ${SET_GUARDRAILS_TOOL} exactly once — never answer in plain text.

Only include a field if the text actually implies it — omit anything not mentioned so existing settings aren't overwritten. blockedTopics and competitorNames are short topic/name strings pulled from the text, not full sentences. aiDisclosureMessage is the literal disclosure wording if the admin gives exact wording, otherwise a short natural sentence that captures their intent. Booleans (promptInjectionScreening, groundednessCheck, piiLeakageCheck, forbiddenClaimsCheck, profanityCheck, blockingMode) are only set when the text clearly turns something on or off — most descriptions won't mention these at all.`;

/**
 * Phase 3 M4 spike: a forced-single-tool-call pattern (offer exactly one
 * tool, require the model to call it) — no free-text JSON parsing, no new
 * gateway capability. The tool's parameters mirror AgentGuardrailConfig field-for-
 * field so the response merges straight into the existing structured form
 * (mergeGuardrailPatch below) instead of replacing it — the toggles/chip-
 * lists stay the source of truth and the only place to see exactly what
 * got set.
 */
export function buildInterpretRequest(text: string): ChatRequest {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    tools: [
      {
        name: SET_GUARDRAILS_TOOL,
        description: "Set the guardrail fields this description implies.",
        parameters: {
          type: "object",
          properties: {
            input: {
              type: "object",
              properties: {
                promptInjectionScreening: { type: "boolean" },
                blockedTopics: { type: "array", items: { type: "string" } },
                competitorNames: { type: "array", items: { type: "string" } },
              },
            },
            output: {
              type: "object",
              properties: {
                groundednessCheck: { type: "boolean" },
                piiLeakageCheck: { type: "boolean" },
                piiMode: { type: "string", enum: ["block", "redact"] },
                forbiddenClaimsCheck: { type: "boolean" },
                profanityCheck: { type: "boolean" },
                aiDisclosureMessage: { type: "string" },
                blockingMode: { type: "boolean" },
              },
            },
          },
        },
      },
    ],
    maxOutputTokens: 512,
  };
}

function asPatch(raw: unknown): AgentGuardrailConfig {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const patch: AgentGuardrailConfig = {};

  if (obj.input && typeof obj.input === "object") {
    const input = obj.input as Record<string, unknown>;
    patch.input = {};
    if (typeof input.promptInjectionScreening === "boolean") patch.input.promptInjectionScreening = input.promptInjectionScreening;
    if (Array.isArray(input.blockedTopics)) patch.input.blockedTopics = input.blockedTopics.filter((v): v is string => typeof v === "string");
    if (Array.isArray(input.competitorNames)) patch.input.competitorNames = input.competitorNames.filter((v): v is string => typeof v === "string");
  }

  if (obj.output && typeof obj.output === "object") {
    const output = obj.output as Record<string, unknown>;
    patch.output = {};
    if (typeof output.groundednessCheck === "boolean") patch.output.groundednessCheck = output.groundednessCheck;
    if (typeof output.piiLeakageCheck === "boolean") patch.output.piiLeakageCheck = output.piiLeakageCheck;
    if (output.piiMode === "block" || output.piiMode === "redact") patch.output.piiMode = output.piiMode;
    if (typeof output.forbiddenClaimsCheck === "boolean") patch.output.forbiddenClaimsCheck = output.forbiddenClaimsCheck;
    if (typeof output.profanityCheck === "boolean") patch.output.profanityCheck = output.profanityCheck;
    if (typeof output.aiDisclosureMessage === "string") patch.output.aiDisclosureMessage = output.aiDisclosureMessage;
    if (typeof output.blockingMode === "boolean") patch.output.blockingMode = output.blockingMode;
  }

  return patch;
}

/** Reads set_guardrails' arguments off a ChatResponse.toolCalls array — {} if the model didn't call it or called something else. */
export function extractGuardrailPatch(toolCalls: { name: string; arguments: Record<string, unknown> }[]): AgentGuardrailConfig {
  const call = toolCalls.find((c) => c.name === SET_GUARDRAILS_TOOL);
  return call ? asPatch(call.arguments) : {};
}

/**
 * Additive merge, same convention as the escalation/guardrail chip-list
 * inputs elsewhere in the editor ("appended to this agent's built-in
 * scanner lists — never replaces them"): arrays union+dedupe, scalars only
 * overwrite when the patch actually sets them. Re-running this on top of
 * manual edits never silently drops something the admin already configured
 * by hand.
 */
export function mergeGuardrailPatch(current: AgentGuardrailConfig, patch: AgentGuardrailConfig): AgentGuardrailConfig {
  const mergeList = (a?: string[], b?: string[]): string[] | undefined => (a || b ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined);
  return {
    input: {
      ...current.input,
      ...patch.input,
      blockedTopics: mergeList(current.input?.blockedTopics, patch.input?.blockedTopics),
      competitorNames: mergeList(current.input?.competitorNames, patch.input?.competitorNames),
    },
    output: {
      ...current.output,
      ...patch.output,
    },
  };
}
