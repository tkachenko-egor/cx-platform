import type { GuardrailCheckResult } from "./types";

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

export function checkPiiLeakage(assistantText: string, toolResultsText: string): GuardrailCheckResult {
  const reasons: string[] = [];
  for (const pattern of [EMAIL_PATTERN, PHONE_PATTERN]) {
    for (const match of assistantText.matchAll(pattern)) {
      if (!toolResultsText.includes(match[0])) reasons.push(`unattributed_pii:${pattern === EMAIL_PATTERN ? "email" : "phone"}`);
    }
  }
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
