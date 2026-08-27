import type { AgentGuardrailConfig, GuardrailCheckResult } from "./types";
import type { PiiSpan } from "./presidio";
import { scanForPromptInjection } from "./input";
import { checkGroundedness, checkPiiLeakage, checkForbiddenClaims, checkProfanity } from "./output";

function merge(...results: GuardrailCheckResult[]): GuardrailCheckResult {
  const reasons = results.flatMap((r) => r.reasons);
  const redactedText = results.find((r) => r.redactedText !== undefined)?.redactedText;
  return { blocked: reasons.length > 0, reasons, ...(redactedText !== undefined ? { redactedText } : {}) };
}

/** Phase 8 M2: config-driven, not a hardcoded marker file like scanForPromptInjection — blockedTopics and competitorNames are mechanically identical (a keyword hit blocks input), kept as two lists only so an admin's report of "which one fired" stays legible. */
function scanKeywordList(text: string, keywords: string[] | undefined, label: string): GuardrailCheckResult {
  if (!keywords || keywords.length === 0) return { blocked: false, reasons: [] };
  const lower = text.toLowerCase();
  const hit = keywords.find((k) => lower.includes(k.toLowerCase()));
  return hit ? { blocked: true, reasons: [`${label}:${hit}`] } : { blocked: false, reasons: [] };
}

/** Runs before KB retrieval — cheap, and worth skipping retrieval entirely over if it blocks. */
export function checkUserInputGuardrails(config: AgentGuardrailConfig, userText: string): GuardrailCheckResult {
  const checks: GuardrailCheckResult[] = [];
  if (config.input?.promptInjectionScreening !== false) {
    const scan = scanForPromptInjection(userText);
    if (scan.hit) checks.push({ blocked: true, reasons: [`prompt_injection:user_input:${scan.matched}`] });
  }
  checks.push(scanKeywordList(userText, config.input?.blockedTopics, "blocked_topic"));
  checks.push(scanKeywordList(userText, config.input?.competitorNames, "competitor_mention"));
  return merge(...checks);
}

/** Runs on retrieved chunks before they're interpolated into the prompt (FR-7.13). */
export function checkRetrievedChunkGuardrails(config: AgentGuardrailConfig, chunks: { docId: string; text: string }[]): GuardrailCheckResult {
  if (config.input?.promptInjectionScreening === false) return { blocked: false, reasons: [] };
  const reasons: string[] = [];
  for (const chunk of chunks) {
    const scan = scanForPromptInjection(chunk.text);
    if (scan.hit) reasons.push(`prompt_injection:kb:${chunk.docId}:${scan.matched}`);
  }
  return { blocked: reasons.length > 0, reasons };
}

/**
 * Runs once the tool loop has a final assistant reply.
 *
 * A2: `opts.piiSpans` is Presidio's typed detection for `assistantText`,
 * resolved by the caller (it needs an async HTTP call, kept out of this
 * sync function). `null`/omitted → checkPiiLeakage uses its regex fallback.
 */
export function checkOutputGuardrails(
  config: AgentGuardrailConfig,
  assistantText: string,
  citableDocIds: string[],
  toolResultsText: string,
  opts: { piiSpans?: PiiSpan[] | null } = {},
): GuardrailCheckResult {
  const outputConfig = config.output ?? {};
  const checks: GuardrailCheckResult[] = [];
  if (outputConfig.groundednessCheck !== false) checks.push(checkGroundedness(assistantText, citableDocIds));
  if (outputConfig.piiLeakageCheck !== false) checks.push(checkPiiLeakage(assistantText, toolResultsText, outputConfig.piiMode ?? "block", { spans: opts.piiSpans }));
  if (outputConfig.forbiddenClaimsCheck !== false) checks.push(checkForbiddenClaims(assistantText));
  if (outputConfig.profanityCheck !== false) checks.push(checkProfanity(assistantText));
  return merge(...checks);
}
