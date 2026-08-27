/**
 * A2: typed PII detection via a Microsoft Presidio analyzer sidecar. Nothing
 * Python enters the Node process — this is a raw fetch against Presidio's
 * REST API, same thin-adapter shape as src/gateway/embeddings/openai.ts.
 *
 * The sidecar URL is deployment config (PRESIDIO_URL), read only here. When
 * it is unset or the call fails, analyzePii returns null and the caller
 * falls back to the offline regex checks in src/guardrails/output.ts — the
 * guardrail still runs, it does not fail open silently.
 */

export interface PiiSpan {
  /** Presidio entity type, e.g. CREDIT_CARD, IBAN_CODE, PERSON, EMAIL_ADDRESS, PHONE_NUMBER, US_SSN. */
  entityType: string;
  start: number;
  end: number;
  score: number;
  /** The matched substring, sliced from the analyzed text by offset. */
  text: string;
}

interface PresidioAnalyzerResult {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

export interface AnalyzePiiOptions {
  /** Restrict detection to these Presidio entity types (the per-agent allow list). Omit to let Presidio return every recognizer's hits. */
  entities?: string[];
  /** Minimum confidence, 0–1. Presidio's own default is 0 (everything); we default to 0.5 to match the precision the regex fallback implies. */
  scoreThreshold?: number;
  language?: string;
  /** Test seam — overrides PRESIDIO_URL. */
  url?: string;
}

const DEFAULT_SCORE_THRESHOLD = 0.5;

/**
 * Returns the PII spans Presidio found in `text`, or `null` when the sidecar
 * is not configured or unreachable (caller must fall back, not pass).
 */
export async function analyzePii(text: string, opts: AnalyzePiiOptions = {}): Promise<PiiSpan[] | null> {
  const url = opts.url ?? process.env.PRESIDIO_URL;
  if (!url) return null;
  if (text.trim() === "") return [];

  const endpoint = `${url.replace(/\/$/, "")}/analyze`;
  const body: Record<string, unknown> = {
    text,
    language: opts.language ?? "en",
    score_threshold: opts.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD,
  };
  if (opts.entities && opts.entities.length > 0) body.entities = opts.entities;

  let results: PresidioAnalyzerResult[];
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[guardrails] Presidio analyze failed (${res.status}) — falling back to regex PII checks`);
      return null;
    }
    results = (await res.json()) as PresidioAnalyzerResult[];
  } catch (err) {
    console.warn(`[guardrails] Presidio unreachable (${err instanceof Error ? err.message : String(err)}) — falling back to regex PII checks`);
    return null;
  }

  if (!Array.isArray(results)) {
    console.warn(`[guardrails] Presidio returned an unexpected shape — falling back to regex PII checks`);
    return null;
  }

  return results.map((r) => ({
    entityType: r.entity_type,
    start: r.start,
    end: r.end,
    score: r.score,
    text: text.slice(r.start, r.end),
  }));
}
