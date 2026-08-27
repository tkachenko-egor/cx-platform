import type { GuardrailCheckResult } from "./types";
import type { PiiSpan } from "./presidio";

/**
 * FR-12.7/FR-6.14: every `[doc_id]`-style citation must resolve to a doc
 * actually retrieved this turn. Deterministic, no model call — reuses the
 * same citableDocs list the customer-facing citation chips are built from.
 * Restricted to hyphenated bracket contents (real doc_ids are kebab-case,
 * e.g. [returns-and-refunds]) so ordinary bracketed text ([1], [note])
 * doesn't false-positive.
 */
const CITATION_MARKER = /\[([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\]/gi;

export function checkGroundedness(assistantText: string, citableDocIds: string[]): GuardrailCheckResult {
  const citable = new Set(citableDocIds.map((id) => id.toLowerCase()));
  const reasons: string[] = [];
  for (const match of assistantText.matchAll(CITATION_MARKER)) {
    const docId = match[1].toLowerCase();
    if (!citable.has(docId)) reasons.push(`uncited_doc_reference:${docId}`);
  }
  return { blocked: reasons.length > 0, reasons };
}

/**
 * Heuristic PII-leakage check (FR-6.14): flags an email/phone-looking
 * pattern in the reply that doesn't appear verbatim in this turn's tool
 * results. Legitimate relay of the identified customer's own data (their
 * email echoed back from lookup_order, say) is sourced from a tool result
 * and passes; anything the model surfaced from nowhere doesn't.
 */
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * Phase 8 M2: `mode: "redact"` masks the unattributed PII in place and
 * returns it unblocked instead — but see AgentGuardrailConfig.output.piiMode's
 * doc comment: this only has a real effect when the caller buffers the whole
 * reply before it reaches the customer (blockingMode). In the default
 * streaming mode the raw text has already gone out by the time this check
 * runs, so redactedText is computed correctly here but nothing downstream
 * can un-send what already streamed.
 *
 * A2: when `opts.spans` is supplied (a non-null array), it is Presidio's
 * typed entity detection for this reply and drives the check — cards, IBANs,
 * national IDs, person names, addresses, not just email/phone. `null` or
 * omitted means the sidecar was unavailable, so the original email/phone
 * regexes run as the offline fallback. The attribution rule is identical in
 * both paths: PII that appears verbatim in this turn's tool results is a
 * legitimate relay and passes.
 */
export function checkPiiLeakage(
  assistantText: string,
  toolResultsText: string,
  mode: "block" | "redact" = "block",
  opts: { spans?: PiiSpan[] | null } = {},
): GuardrailCheckResult {
  const reasons: string[] = [];
  let redactedText = assistantText;

  if (opts.spans != null) {
    for (const span of opts.spans) {
      if (span.text === "" || toolResultsText.includes(span.text)) continue;
      reasons.push(`unattributed_pii:${span.entityType.toLowerCase()}`);
      if (mode === "redact") redactedText = redactedText.split(span.text).join("[redacted]");
    }
  } else {
    for (const pattern of [EMAIL_PATTERN, PHONE_PATTERN]) {
      for (const match of assistantText.matchAll(pattern)) {
        if (!toolResultsText.includes(match[0])) {
          reasons.push(`unattributed_pii:${pattern === EMAIL_PATTERN ? "email" : "phone"}`);
          if (mode === "redact") redactedText = redactedText.split(match[0]).join("[redacted]");
        }
      }
    }
  }

  if (reasons.length === 0) return { blocked: false, reasons: [] };
  return mode === "redact" ? { blocked: false, reasons, redactedText } : { blocked: true, reasons };
}

/** Phase 8 M2: small built-in profanity/abuse marker list, same style and same "deterministic backstop" spirit as FORBIDDEN_CLAIM_MARKERS below — not an exhaustive NLP classifier. */
const PROFANITY_MARKERS: string[] = ["fuck", "shit", "asshole", "bastard", "bitch", "cunt", "dumbass", "idiot", "moron", "stupid customer"];

export function checkProfanity(assistantText: string): GuardrailCheckResult {
  const lower = assistantText.toLowerCase();
  const reasons = PROFANITY_MARKERS.filter((marker) => lower.includes(marker)).map((marker) => `profanity:${marker}`);
  return { blocked: reasons.length > 0, reasons };
}

/** FR-6.14: no refund promises, no legal/medical claims — the system prompt already forbids these; this is the deterministic backstop. */
const FORBIDDEN_CLAIM_MARKERS: string[] = [
  "i guarantee",
  "guaranteed refund",
  "you will definitely be refunded",
  "i promise you will be refunded",
  "this will cure",
  "this product treats",
  "this will heal",
  "medically proven",
  "fda approved",
  "clinically proven to cure",
  "you don't need to see a doctor",
  "you do not need to see a doctor",
  "no need to consult a doctor",
];

export function checkForbiddenClaims(assistantText: string): GuardrailCheckResult {
  const lower = assistantText.toLowerCase();
  const reasons = FORBIDDEN_CLAIM_MARKERS.filter((marker) => lower.includes(marker)).map((marker) => `forbidden_claim:${marker}`);
  return { blocked: reasons.length > 0, reasons };
}
