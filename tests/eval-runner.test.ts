import { describe, expect, it } from "vitest";
import { evaluateTurn, summarize, checkThresholds, contextRecall, contextPrecision, type CaseResult, type TurnOutcome } from "../scripts/eval/scoring";
import { buildReport, diffAgainstBaseline, renderDiffMarkdown, type EvalReport } from "../scripts/eval/report";

function outcome(overrides: Partial<TurnOutcome> = {}): TurnOutcome {
  return { assistantText: "", toolCallsMade: [], escalate: false, escalationReasons: [], guardrailBlocked: false, citableDocs: [], ...overrides };
}

describe("evaluateTurn", () => {
  it("passes cleanly when every expectation matches", () => {
    const failures = evaluateTurn({ userText: "hi", expectedEscalate: false }, outcome());
    expect(failures).toEqual([]);
  });

  it("flags a route mismatch", () => {
    const failures = evaluateTurn({ userText: "hi", expectedRoute: "billing-specialist" }, outcome({ route: "technical-specialist" }));
    expect(failures).toEqual([{ field: "route", expected: "billing-specialist", actual: "technical-specialist" }]);
  });

  it("flags a missing expected tool call without requiring an exact-match set", () => {
    const failures = evaluateTurn({ userText: "hi", expectedToolCalls: ["lookup_order"] }, outcome({ toolCallsMade: ["search_products"] }));
    expect(failures).toHaveLength(1);
    expect(failures[0].field).toBe("toolCalls");
  });

  it("does not flag extra tool calls beyond what was expected", () => {
    const failures = evaluateTurn({ userText: "hi", expectedToolCalls: ["lookup_order"] }, outcome({ toolCallsMade: ["lookup_order", "search_products"] }));
    expect(failures).toEqual([]);
  });

  it("flags an escalation boolean mismatch", () => {
    const failures = evaluateTurn({ userText: "hi", expectedEscalate: true }, outcome({ escalate: false }));
    expect(failures).toEqual([{ field: "escalate", expected: true, actual: false }]);
  });

  it("flags a missing expected escalation reason", () => {
    const failures = evaluateTurn({ userText: "hi", expectedEscalationReasons: ["severe_symptom"] }, outcome({ escalationReasons: ["human_request"] }));
    expect(failures).toHaveLength(1);
    expect(failures[0].field).toBe("escalationReasons");
  });

  it("flags a forbidden phrase that leaked through, case-insensitively", () => {
    const failures = evaluateTurn({ userText: "hi", forbiddenPhrases: ["guaranteed refund"] }, outcome({ assistantText: "This is a GUARANTEED REFUND for you." }));
    expect(failures).toHaveLength(1);
    expect(failures[0].field).toBe("forbiddenPhrases");
  });

  it("flags a missing expected citation", () => {
    const failures = evaluateTurn({ userText: "hi", expectedCitations: ["returns-and-refunds"] }, outcome({ citableDocs: ["shipping-and-delivery"] }));
    expect(failures).toHaveLength(1);
    expect(failures[0].field).toBe("citations");
  });

  it("ignores fields the golden turn didn't assert on", () => {
    const failures = evaluateTurn({ userText: "hi" }, outcome({ escalate: true, toolCallsMade: ["anything"], route: "whatever" }));
    expect(failures).toEqual([]);
  });
});

describe("summarize", () => {
  const results: CaseResult[] = [
    { id: "a", tags: ["routing"], passed: true, failures: [] },
    { id: "b", tags: ["routing"], passed: false, failures: [] },
    { id: "c", tags: ["tools", "escalation"], passed: true, failures: [] },
    { id: "d", tags: ["escalation"], passed: true, failures: [] },
  ];

  it("computes an overall pass rate across every case", () => {
    const summary = summarize(results);
    expect(summary.overall).toEqual({ passed: 3, total: 4, rate: 0.75 });
  });

  it("computes a per-tag pass rate, with a case counted once per tag it carries", () => {
    const summary = summarize(results);
    expect(summary.byTag.routing).toEqual({ passed: 1, total: 2, rate: 0.5 });
    expect(summary.byTag.tools).toEqual({ passed: 1, total: 1, rate: 1 });
    expect(summary.byTag.escalation).toEqual({ passed: 2, total: 2, rate: 1 });
  });

  it("returns an empty summary for an empty result set without dividing by zero", () => {
    const summary = summarize([]);
    expect(summary.overall).toEqual({ passed: 0, total: 0, rate: 1 });
  });
});

describe("checkThresholds (FR-12.4 regression gate)", () => {
  it("passes when every gated metric meets its threshold", () => {
    const summary = summarize([
      { id: "a", tags: ["routing"], passed: true, failures: [] },
      { id: "b", tags: ["routing"], passed: true, failures: [] },
    ]);
    const gate = checkThresholds(summary, { routing: 0.9 });
    expect(gate.ok).toBe(true);
    expect(gate.misses).toEqual([]);
  });

  it("fails and reports every metric that misses its threshold", () => {
    const summary = summarize([
      { id: "a", tags: ["routing"], passed: false, failures: [] },
      { id: "b", tags: ["routing"], passed: true, failures: [] },
    ]);
    const gate = checkThresholds(summary, { routing: 0.9 });
    expect(gate.ok).toBe(false);
    expect(gate.misses).toEqual([{ metric: "routing", actual: 0.5, threshold: 0.9 }]);
  });

  it("treats a metric with zero matching cases as vacuously fine rather than a gate failure", () => {
    const summary = summarize([{ id: "a", tags: ["routing"], passed: true, failures: [] }]);
    const gate = checkThresholds(summary, { guardrails: 0.9 });
    expect(gate.ok).toBe(true);
  });
});

describe("A3: retrieval metrics", () => {
  it("contextRecall is the fraction of expected docs that were retrieved", () => {
    expect(contextRecall(["a", "b"], ["a", "b", "c"])).toBe(1);
    expect(contextRecall(["a", "b"], ["a", "x"])).toBe(0.5);
    expect(contextRecall([], ["a"])).toBe(1);
  });

  it("contextPrecision is the fraction of retrieved docs that were expected", () => {
    expect(contextPrecision(["a"], ["a"])).toBe(1);
    expect(contextPrecision(["a"], ["a", "b"])).toBe(0.5);
    expect(contextPrecision(["a"], [])).toBe(0);
  });

  it("summarize averages per-turn retrieval scores and reports null when nothing was measured", () => {
    const withRetrieval = summarize([
      { id: "a", tags: ["retrieval"], passed: true, failures: [], retrieval: [{ contextRecall: 1, contextPrecision: 0.5, faithfulness: null }] },
      { id: "b", tags: ["retrieval"], passed: true, failures: [], retrieval: [{ contextRecall: 0.5, contextPrecision: 0.5, faithfulness: null }] },
    ]);
    expect(withRetrieval.retrieval.contextRecall).toBe(0.75);
    expect(withRetrieval.retrieval.contextPrecision).toBe(0.5);
    expect(withRetrieval.retrieval.faithfulness).toBeNull();
    expect(withRetrieval.retrieval.turnsScored).toBe(2);

    const noRetrieval = summarize([{ id: "a", tags: ["routing"], passed: true, failures: [] }]);
    expect(noRetrieval.retrieval.contextRecall).toBeNull();
    expect(noRetrieval.retrieval.turnsScored).toBe(0);
  });

  it("checkThresholds fails the gate on a retrieval-metric miss, exactly like a tag miss", () => {
    const summary = summarize([
      { id: "a", tags: ["retrieval"], passed: true, failures: [], retrieval: [{ contextRecall: 0.6, contextPrecision: 0.9, faithfulness: null }] },
    ]);
    const gate = checkThresholds(summary, { contextRecall: 0.9, contextPrecision: 0.3 });
    expect(gate.ok).toBe(false);
    expect(gate.misses).toEqual([{ metric: "contextRecall", actual: 0.6, threshold: 0.9 }]);
  });

  it("skips a retrieval metric that was not measured (null) instead of failing it", () => {
    const summary = summarize([{ id: "a", tags: ["routing"], passed: true, failures: [] }]);
    const gate = checkThresholds(summary, { contextRecall: 0.9, faithfulness: 0.8 });
    expect(gate.ok).toBe(true);
  });
});

describe("A7: eval report + baseline diff", () => {
  const results: CaseResult[] = [
    { id: "a", tags: ["routing"], passed: true, failures: [] },
    { id: "b", tags: ["routing"], passed: false, failures: [] },
    { id: "c", tags: ["retrieval"], passed: true, failures: [], retrieval: [{ contextRecall: 1, contextPrecision: 0.5, faithfulness: null }] },
  ];
  const summary = summarize(results);
  const gate = checkThresholds(summary, { routing: 0.9 });
  const report = buildReport(summary, results, gate, "2026-08-27T00:00:00.000Z");

  it("buildReport captures the summary, gate and per-case pass/fail without re-running anything", () => {
    expect(report.overall).toEqual({ passed: 2, total: 3, rate: 2 / 3 });
    expect(report.gate.ok).toBe(false);
    expect(report.cases).toEqual([
      { id: "a", tags: ["routing"], passed: true },
      { id: "b", tags: ["routing"], passed: false },
      { id: "c", tags: ["retrieval"], passed: true },
    ]);
  });

  it("diffAgainstBaseline reports metric deltas and which cases flipped", () => {
    const baseline: EvalReport = {
      ...report,
      overall: { passed: 3, total: 3, rate: 1 },
      byTag: { routing: { passed: 2, total: 2, rate: 1 } },
      cases: [
        { id: "a", tags: ["routing"], passed: true },
        { id: "b", tags: ["routing"], passed: true },
        { id: "removed", tags: ["tools"], passed: true },
      ],
    };
    const diff = diffAgainstBaseline(report, baseline);
    expect(diff.hasBaseline).toBe(true);
    expect(diff.casesRegressed).toEqual(["b"]);
    expect(diff.casesAdded).toEqual(["c"]);
    expect(diff.casesRemoved).toEqual(["removed"]);
    const overall = diff.metrics.find((m) => m.metric === "overall")!;
    expect(overall.delta).toBeCloseTo(2 / 3 - 1);
  });

  it("diffAgainstBaseline degrades gracefully with no baseline", () => {
    const diff = diffAgainstBaseline(report, null);
    expect(diff.hasBaseline).toBe(false);
    expect(renderDiffMarkdown(diff)).toContain("No baseline stored");
  });
});
