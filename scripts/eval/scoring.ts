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

export interface CaseResult {
  id: string;
  tags: string[];
  passed: boolean;
  failures: { turnIndex: number; failures: AssertionFailure[] }[];
}

export interface MetricSummary {
  passed: number;
  total: number;
  rate: number;
}

export interface EvalSummary {
  overall: MetricSummary;
  byTag: Record<string, MetricSummary>;
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

  return { overall, byTag };
}

export interface Thresholds {
  [metricTag: string]: number;
}

/** FR-12.4: the regression gate. A metric with zero matching cases is treated as vacuously fine, not a failure — it just isn't gated yet. */
export function checkThresholds(summary: EvalSummary, thresholds: Thresholds): { ok: boolean; misses: { metric: string; actual: number; threshold: number }[] } {
  const misses: { metric: string; actual: number; threshold: number }[] = [];
  for (const [metric, threshold] of Object.entries(thresholds)) {
    const actual = summary.byTag[metric]?.rate ?? 1;
    if (actual < threshold) misses.push({ metric, actual, threshold });
  }
  return { ok: misses.length === 0, misses };
}
