import { INJECTION_MARKERS, INJECTION_PATTERNS } from "./injection-markers";

/**
 * FR-6.13/NFR-4.4: deterministic prompt-injection screening — same pattern
 * as src/agents/escalation.ts's marker scanners. Applied both to the raw
 * user message and, separately, to each retrieved KB chunk (FR-7.13:
 * retrieved content is untrusted — a poisoned KB article is a real attack).
 *
 * A4: the marker list itself lives in ./injection-markers.ts (adapted from
 * LLM Guard, MIT). This module owns only the matching, which normalises
 * case and whitespace first so an attacker can't slip a marker past an
 * exact substring scan by inserting spaces or zero-width characters.
 */

// Zero-width space / non-joiner / joiner / word-joiner / BOM.
const ZERO_WIDTH = /[​‌‍⁠﻿]/g;

/** Lowercase, strip zero-width characters, collapse every whitespace run to a single space. */
function normalize(text: string): string {
  return text.toLowerCase().replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
}

/**
 * Markers at least this long (after removing spaces) are also matched
 * against a fully despaced copy of the input — catching `i g n o r e
 * previous instructions` — while staying long enough that the despaced form
 * can't collide with ordinary prose.
 */
const DESPACED_MATCH_MIN_LENGTH = 12;

export function scanForPromptInjection(text: string): { hit: boolean; matched?: string } {
  const normalized = normalize(text);
  const despaced = normalized.replace(/ /g, "");

  for (const marker of INJECTION_MARKERS) {
    const m = marker.toLowerCase();
    if (normalized.includes(m)) return { hit: true, matched: marker };

    const despacedMarker = m.replace(/ /g, "");
    if (despacedMarker.length >= DESPACED_MATCH_MIN_LENGTH && despaced.includes(despacedMarker)) {
      return { hit: true, matched: marker };
    }
  }

  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match) return { hit: true, matched: match[0] };
  }

  return { hit: false };
}
