import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../../src/db/client";
import { seedFixtures } from "../../src/testing/seed-fixtures";
import { StubProvider } from "../../src/gateway/providers/stub";
import { ensureConversation, processInboundTurn } from "../../src/channel/turn";
import { ConversationRepository } from "../../src/db/repositories/conversation-repository";
import { RunRepository } from "../../src/db/repositories/run-repository";
import { ToolCallRepository } from "../../src/db/repositories/tool-repository";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../../src/gateway/types";
import {
  evaluateTurn,
  summarize,
  checkThresholds,
  contextRecall,
  contextPrecision,
  type GoldenCase,
  type ScriptedChatResponse,
  type CaseResult,
  type TurnOutcome,
  type TurnRetrievalScore,
} from "./scoring";
import { buildReport, renderReportMarkdown, diffAgainstBaseline, renderDiffMarkdown, type EvalReport } from "./report";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// CLAUDE.md invariant #6: the return-window cases below are dated against
// the fixture orders, so the harness pins "today" exactly like the tests do
// — otherwise the gate silently starts failing once a window lapses.
process.env.DEMO_DATE ??= "2026-08-21";

/** Plays back a fixed, hand-authored sequence of "what the model would say" — deterministic, no API key, no network. */
class ScriptedProvider implements ProviderAdapter {
  readonly provider = "scripted";
  private calls = 0;
  constructor(private readonly script: ChatResponse[]) {}

  async chat(): Promise<ChatResponse> {
    return this.next();
  }

  async chatStream(_model: string, _request: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse> {
    const response = this.next();
    if (response.content) onDelta(response.content);
    return response;
  }

  private next(): ChatResponse {
    if (this.calls >= this.script.length) {
      throw new Error(`ScriptedProvider ran out of scripted responses (${this.script.length} available) — the case scripted fewer model turns than the run actually needed`);
    }
    return this.script[this.calls++];
  }
}

function toFullResponse(r: ScriptedChatResponse): ChatResponse {
  const toolCalls = (r.toolCalls ?? []).map((tc, i) => ({ id: `sc-${i}`, name: tc.name, arguments: tc.arguments }));
  return {
    content: r.content ?? "",
    toolCalls,
    stopReason: r.stopReason ?? (toolCalls.length > 0 ? "tool_use" : "end_turn"),
    usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
  };
}

async function runCase(golden: GoldenCase): Promise<CaseResult> {
  const script: ChatResponse[] = [];
  for (const turn of golden.turns) {
    if (turn.scriptedResponse) {
      const responses = Array.isArray(turn.scriptedResponse) ? turn.scriptedResponse : [turn.scriptedResponse];
      for (const r of responses) script.push(toFullResponse(r));
    }
  }

  const db = createDb(":memory:");
  const provider = new ScriptedProvider(script);
  const { tenant, gateway, embeddings } = await seedFixtures({
    db,
    providers: { scripted: provider, stub: new StubProvider() },
    supportMain: { provider: "scripted", model: "scripted-1" },
  });

  const conversation = ensureConversation({ db }, tenant, undefined, "widget");
  const conversations = new ConversationRepository(db, tenant);
  const runs = new RunRepository(db, tenant);
  const toolCalls = new ToolCallRepository(db, tenant);

  const turnFailures: CaseResult["failures"] = [];
  const retrieval: TurnRetrievalScore[] = [];

  for (let i = 0; i < golden.turns.length; i++) {
    const turn = golden.turns[i];
    const runsBefore = runs.listByConversation(conversation.id).length;

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: turn.userText });

    const newRuns = runs.listByConversation(conversation.id).slice(runsBefore);
    const toolCallsMade = newRuns.flatMap((r) => toolCalls.listByRun(r.id).map((tc) => tc.toolKey));
    const conv = conversations.get(conversation.id);

    const outcome: TurnOutcome = {
      assistantText: result.assistantText,
      route: conv?.currentAgentId ?? undefined,
      toolCallsMade,
      escalate: result.handoff,
      escalationReasons: (result.escalationReasons ?? []) as string[],
      guardrailBlocked: (result.escalationReasons ?? []).includes("guardrail_blocked"),
      citableDocs: (result.citableDocs ?? []).map((d) => d.docId),
    };

    const failures = evaluateTurn(turn, outcome);
    if (failures.length > 0) turnFailures.push({ turnIndex: i, failures });

    // A3: outcome.citableDocs is the deduped set of docs retrieved this turn
    // (runtime.ts builds it straight off `retrieved`). faithfulness stays
    // null until a judge model + retrieved-chunk-text plumbing are wired —
    // both out of A3's file scope — so it is reported as skipped, not failed.
    if (turn.expectedRetrievedDocs && turn.expectedRetrievedDocs.length > 0) {
      retrieval.push({
        contextRecall: contextRecall(turn.expectedRetrievedDocs, outcome.citableDocs),
        contextPrecision: contextPrecision(turn.expectedRetrievedDocs, outcome.citableDocs),
        faithfulness: null,
      });
    }
  }

  return { id: golden.id, tags: golden.tags, passed: turnFailures.length === 0, failures: turnFailures, retrieval };
}

const THRESHOLD_DESCRIPTIONS: Record<string, string> = {
  routing: "routing accuracy",
  tools: "tool-selection accuracy",
  escalation: "refusal/escalation appropriateness",
  guardrails: "guardrail correctness",
  contextRecall: "retrieval context recall",
  contextPrecision: "retrieval context precision",
  faithfulness: "answer faithfulness",
};

async function main() {
  const golden = JSON.parse(fs.readFileSync(path.join(moduleDir, "../../tests/eval/golden-conversations.json"), "utf-8")) as GoldenCase[];
  const thresholds = JSON.parse(fs.readFileSync(path.join(moduleDir, "thresholds.json"), "utf-8")) as Record<string, number>;

  console.log(`Running ${golden.length} golden case(s)...\n`);

  const results: CaseResult[] = [];
  for (const goldenCase of golden) {
    try {
      const result = await runCase(goldenCase);
      results.push(result);
      console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.id}`);
      for (const f of result.failures) {
        for (const failure of f.failures) {
          console.log(`      turn ${f.turnIndex}: ${failure.field} — expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`);
        }
      }
    } catch (err) {
      results.push({ id: goldenCase.id, tags: goldenCase.tags, passed: false, failures: [{ turnIndex: -1, failures: [{ field: "error", expected: "no exception", actual: err instanceof Error ? err.message : String(err) }] }] });
      console.log(`FAIL  ${goldenCase.id}\n      threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary = summarize(results);
  console.log(`\nOverall: ${summary.overall.passed}/${summary.overall.total} (${(summary.overall.rate * 100).toFixed(0)}%)`);
  for (const [tag, m] of Object.entries(summary.byTag)) {
    console.log(`  ${THRESHOLD_DESCRIPTIONS[tag] ?? tag}: ${m.passed}/${m.total} (${(m.rate * 100).toFixed(0)}%)`);
  }

  // A3: retrieval metrics — a null value means "not measured" (no annotated
  // turns, or no judge model for faithfulness) and is skipped by the gate.
  const { retrieval } = summary;
  const fmtMetric = (value: number | null, skipHint: string) => (value === null ? `skipped (${skipHint})` : `${(value * 100).toFixed(0)}%`);
  console.log(`\nRetrieval (${retrieval.turnsScored} turn(s) scored):`);
  console.log(`  context recall: ${fmtMetric(retrieval.contextRecall, "no turns carried expectedRetrievedDocs")}`);
  console.log(`  context precision: ${fmtMetric(retrieval.contextPrecision, "no turns carried expectedRetrievedDocs")}`);
  console.log(`  answer faithfulness: ${fmtMetric(retrieval.faithfulness, "no judge model configured")}`);

  const gate = checkThresholds(summary, thresholds);

  // A7: reporting only — does not change how cases run, and the gate below is
  // still the sole CI signal. `report.latest.json` is git-ignored; a run with
  // --update-baseline promotes it to the committed baseline.json.
  const report = buildReport(summary, results, gate);
  const baselinePath = path.join(moduleDir, "baseline.json");
  const baseline = fs.existsSync(baselinePath) ? (JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as EvalReport) : null;
  const diff = diffAgainstBaseline(report, baseline);

  fs.writeFileSync(path.join(moduleDir, "report.latest.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(moduleDir, "report.latest.md"), `${renderReportMarkdown(report)}\n\n${renderDiffMarkdown(diff)}\n`);

  console.log(`\n${renderDiffMarkdown(diff)}`);
  console.log(`\nReport written to scripts/eval/report.latest.{json,md}`);

  if (process.argv.includes("--update-baseline")) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Baseline updated: scripts/eval/baseline.json`);
  }

  if (!gate.ok) {
    console.log(`\nRegression gate FAILED:`);
    for (const miss of gate.misses) {
      console.log(`  ${THRESHOLD_DESCRIPTIONS[miss.metric] ?? miss.metric}: ${(miss.actual * 100).toFixed(0)}% < required ${(miss.threshold * 100).toFixed(0)}%`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nRegression gate passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
