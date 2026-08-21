import { describe, expect, it } from "vitest";
import { evaluateTurn, summarize, checkThresholds, type CaseResult, type TurnOutcome } from "../scripts/eval/scoring";

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
