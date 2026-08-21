import type { AgentGuardrailConfig, GuardrailCheckResult } from "./types";
import { scanForPromptInjection } from "./input";
import { checkGroundedness, checkPiiLeakage, checkForbiddenClaims } from "./output";

function merge(...results: GuardrailCheckResult[]): GuardrailCheckResult {
  const reasons = results.flatMap((r) => r.reasons);
  return { blocked: reasons.length > 0, reasons };
}

/** Runs before KB retrieval — cheap, and worth skipping retrieval entirely over if it blocks. */
export function checkUserInputGuardrails(config: AgentGuardrailConfig, userText: string): GuardrailCheckResult {
  if (config.input?.promptInjectionScreening === false) return { blocked: false, reasons: [] };
  const scan = scanForPromptInjection(userText);
  return scan.hit ? { blocked: true, reasons: [`prompt_injection:user_input:${scan.matched}`] } : { blocked: false, reasons: [] };
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

/** Runs once the tool loop has a final assistant reply. */
export function checkOutputGuardrails(config: AgentGuardrailConfig, assistantText: string, citableDocIds: string[], toolResultsText: string): GuardrailCheckResult {
  const outputConfig = config.output ?? {};
  const checks: GuardrailCheckResult[] = [];
  if (outputConfig.groundednessCheck !== false) checks.push(checkGroundedness(assistantText, citableDocIds));
  if (outputConfig.piiLeakageCheck !== false) checks.push(checkPiiLeakage(assistantText, toolResultsText));
  if (outputConfig.forbiddenClaimsCheck !== false) checks.push(checkForbiddenClaims(assistantText));
  return merge(...checks);
}
