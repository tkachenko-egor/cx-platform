/** Pure scoring logic — no I/O, no DB — so it can be unit-tested fast in tests/eval-runner.test.ts. */

export interface ScriptedChatResponse {
  content?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface GoldenTurn {
  userText: string;
  /** What the model says this turn — one response, or an array for a multi-round tool loop (e.g. a handoff_to_agent call followed by the receiving specialist's reply, on a case that exercises routing). Omit for a turn expected to never reach the model (e.g. a guardrail block). */
  scriptedResponse?: ScriptedChatResponse | ScriptedChatResponse[];
  expectedRoute?: string;
  expectedToolCalls?: string[];
  expectedEscalate?: boolean;
  expectedEscalationReasons?: string[];
  expectedGuardrailBlocked?: boolean;
  expectedCitations?: string[];
  forbiddenPhrases?: string[];
  /**
   * A3: doc_ids this turn's retrieval is expected to surface. Feeds the
   * retrieval metrics (context recall/precision) and the thresholds gate —
   * NOT evaluateTurn, so it never flips a case's pass/fail on its own. Only
   * annotate turns that actually retrieve.
   */
  expectedRetrievedDocs?: string[];
}

export interface GoldenCase {
  id: string;
  description: string;
  tags: string[];
  turns: GoldenTurn[];
}

export interface TurnOutcome {
  assistantText?: string;
  route?: string;
  toolCallsMade: string[];
  escalate: boolean;
  escalationReasons: string[];
  guardrailBlocked: boolean;
  citableDocs: string[];
}

export interface AssertionFailure {
  field: string;
  expected: unknown;
  actual: unknown;
}

export function evaluateTurn(turn: GoldenTurn, outcome: TurnOutcome): AssertionFailure[] {
  const failures: AssertionFailure[] = [];

  if (turn.expectedRoute !== undefined && outcome.route !== turn.expectedRoute) {
    failures.push({ field: "route", expected: turn.expectedRoute, actual: outcome.route });
  }
  if (turn.expectedToolCalls !== undefined) {
    const missing = turn.expectedToolCalls.filter((t) => !outcome.toolCallsMade.includes(t));
    if (missing.length > 0) failures.push({ field: "toolCalls", expected: turn.expectedToolCalls, actual: outcome.toolCallsMade });
  }
  if (turn.expectedEscalate !== undefined && outcome.escalate !== turn.expectedEscalate) {
    failures.push({ field: "escalate", expected: turn.expectedEscalate, actual: outcome.escalate });
  }
  if (turn.expectedEscalationReasons !== undefined) {
    const missing = turn.expectedEscalationReasons.filter((r) => !outcome.escalationReasons.includes(r));
    if (missing.length > 0) failures.push({ field: "escalationReasons", expected: turn.expectedEscalationReasons, actual: outcome.escalationReasons });
  }
  if (turn.expectedGuardrailBlocked !== undefined && outcome.guardrailBlocked !== turn.expectedGuardrailBlocked) {
    failures.push({ field: "guardrailBlocked", expected: turn.expectedGuardrailBlocked, actual: outcome.guardrailBlocked });
  }
  if (turn.expectedCitations !== undefined) {
    const missing = turn.expectedCitations.filter((c) => !outcome.citableDocs.includes(c));
    if (missing.length > 0) failures.push({ field: "citations", expected: turn.expectedCitations, actual: outcome.citableDocs });
  }
  if (turn.forbiddenPhrases) {
    const found = turn.forbiddenPhrases.filter((p) => (outcome.assistantText ?? "").toLowerCase().includes(p.toLowerCase()));
    if (found.length > 0) failures.push({ field: "forbiddenPhrases", expected: `none of ${JSON.stringify(turn.forbiddenPhrases)}`, actual: found });
  }

  return failures;
}

/** A3: per-turn retrieval scores, aggregated by summarize() into EvalSummary.retrieval. */
export interface TurnRetrievalScore {
  contextRecall: number;
  contextPrecision: number;
  /** null when no judge model is configured (offline `npm run eval` / `npm test`). */
  faithfulness: number | null;
}

export interface CaseResult {
  id: string;
  tags: string[];
  passed: boolean;
  failures: { turnIndex: number; failures: AssertionFailure[] }[];
  /** A3: one entry per turn that carried expectedRetrievedDocs. */
  retrieval?: TurnRetrievalScore[];
}

export interface MetricSummary {
  passed: number;
  total: number;
  rate: number;
}

/** A3: means across every scored turn; null means "not measured" (no annotated turns, or no judge for faithfulness) and is treated as vacuously passing, like a tag with zero cases. */
export interface RetrievalMetricSummary {
  contextRecall: number | null;
  contextPrecision: number | null;
  faithfulness: number | null;
  turnsScored: number;
}

export interface EvalSummary {
  overall: MetricSummary;
  byTag: Record<string, MetricSummary>;
  retrieval: RetrievalMetricSummary;
}

/** A3: fraction of the expected docs that retrieval actually surfaced. */
export function contextRecall(expectedDocs: string[], retrievedDocs: string[]): number {
  if (expectedDocs.length === 0) return 1;
  const retrieved = new Set(retrievedDocs);
  return expectedDocs.filter((d) => retrieved.has(d)).length / expectedDocs.length;
}

/** A3: fraction of the retrieved docs that were expected — a proxy for how much noise the retriever mixed in. */
export function contextPrecision(expectedDocs: string[], retrievedDocs: string[]): number {
  if (retrievedDocs.length === 0) return expectedDocs.length === 0 ? 1 : 0;
  const expected = new Set(expectedDocs);
  return retrievedDocs.filter((d) => expected.has(d)).length / retrievedDocs.length;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rate(passes: boolean[]): MetricSummary {
  const passed = passes.filter(Boolean).length;
  const total = passes.length;
  return { passed, total, rate: total === 0 ? 1 : passed / total };
}

/** FR-12.2: per-tag pass rates are what thresholds.json's metric keys (routingAccuracy, toolSelectionAccuracy, refusalAppropriateness) actually gate. */
export function summarize(results: CaseResult[]): EvalSummary {
  const overall = rate(results.map((r) => r.passed));

  const tagBuckets = new Map<string, boolean[]>();
  for (const r of results) {
    for (const tag of r.tags) {
      if (!tagBuckets.has(tag)) tagBuckets.set(tag, []);
      tagBuckets.get(tag)!.push(r.passed);
    }
  }

  const byTag: Record<string, MetricSummary> = {};
  for (const [tag, passes] of tagBuckets) byTag[tag] = rate(passes);

  const retrievalTurns = results.flatMap((r) => r.retrieval ?? []);
  const faithfulnessScores = retrievalTurns.map((t) => t.faithfulness).filter((f): f is number => f !== null);
  const retrieval: RetrievalMetricSummary = {
    contextRecall: mean(retrievalTurns.map((t) => t.contextRecall)),
    contextPrecision: mean(retrievalTurns.map((t) => t.contextPrecision)),
    faithfulness: mean(faithfulnessScores),
    turnsScored: retrievalTurns.length,
  };

  return { overall, byTag, retrieval };
}

export interface Thresholds {
  [metricTag: string]: number;
}

/** A3: threshold keys that read from summary.retrieval rather than summary.byTag. */
const RETRIEVAL_METRIC_KEYS = ["contextRecall", "contextPrecision", "faithfulness"] as const;
type RetrievalMetricKey = (typeof RETRIEVAL_METRIC_KEYS)[number];

/**
 * FR-12.4: the regression gate. A metric with zero matching cases is treated
 * as vacuously fine, not a failure — it just isn't gated yet. A3: the same
 * rule covers a retrieval metric that wasn't measured (no annotated turns,
 * or faithfulness with no judge model) — its summary value is null and it is
 * skipped, not failed.
 */
export function checkThresholds(summary: EvalSummary, thresholds: Thresholds): { ok: boolean; misses: { metric: string; actual: number; threshold: number }[] } {
  const misses: { metric: string; actual: number; threshold: number }[] = [];
  for (const [metric, threshold] of Object.entries(thresholds)) {
    let actual: number;
    if ((RETRIEVAL_METRIC_KEYS as readonly string[]).includes(metric)) {
      const value = summary.retrieval[metric as RetrievalMetricKey];
      if (value === null) continue; // not measured -> vacuously fine
      actual = value;
    } else {
      actual = summary.byTag[metric]?.rate ?? 1;
    }
    if (actual < threshold) misses.push({ metric, actual, threshold });
  }
  return { ok: misses.length === 0, misses };
}
