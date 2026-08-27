/**
 * A7: shareable eval report + baseline diff. Pure formatting/comparison over
 * the summary the runner already produces — it does not change how cases
 * execute, and the CI gate still comes from checkThresholds() in scoring.ts.
 */
import type { CaseResult, EvalSummary, MetricSummary, RetrievalMetricSummary } from "./scoring";

export interface EvalReport {
  generatedAt: string;
  overall: MetricSummary;
  byTag: Record<string, MetricSummary>;
  retrieval: RetrievalMetricSummary;
  gate: { ok: boolean; misses: { metric: string; actual: number; threshold: number }[] };
  cases: { id: string; tags: string[]; passed: boolean }[];
}

export function buildReport(
  summary: EvalSummary,
  results: CaseResult[],
  gate: EvalReport["gate"],
  now: string = new Date().toISOString(),
): EvalReport {
  return {
    generatedAt: now,
    overall: summary.overall,
    byTag: summary.byTag,
    retrieval: summary.retrieval,
    gate,
    cases: results.map((r) => ({ id: r.id, tags: r.tags, passed: r.passed })),
  };
}

const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
const metric = (value: number | null) => (value === null ? "—" : pct(value));

export function renderReportMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# Eval report`, ``, `_${report.generatedAt}_`, ``);
  lines.push(`**Overall:** ${report.overall.passed}/${report.overall.total} (${pct(report.overall.rate)}) — gate ${report.gate.ok ? "passed" : "FAILED"}`, ``);

  lines.push(`| Metric | Rate |`, `| --- | --- |`);
  for (const [tag, m] of Object.entries(report.byTag)) lines.push(`| ${tag} | ${m.passed}/${m.total} (${pct(m.rate)}) |`);
  lines.push(`| context recall | ${metric(report.retrieval.contextRecall)} |`);
  lines.push(`| context precision | ${metric(report.retrieval.contextPrecision)} |`);
  lines.push(`| faithfulness | ${report.retrieval.faithfulness === null ? "skipped" : pct(report.retrieval.faithfulness)} |`);
  lines.push(``);

  if (!report.gate.ok) {
    lines.push(`## Gate misses`, ``);
    for (const m of report.gate.misses) lines.push(`- \`${m.metric}\`: ${pct(m.actual)} < ${pct(m.threshold)}`);
    lines.push(``);
  }

  const failed = report.cases.filter((c) => !c.passed);
  if (failed.length > 0) {
    lines.push(`## Failing cases`, ``);
    for (const c of failed) lines.push(`- ${c.id} \`[${c.tags.join(", ")}]\``);
    lines.push(``);
  }

  return lines.join("\n");
}

export interface MetricDelta {
  metric: string;
  baseline: number | null;
  current: number | null;
  delta: number | null;
}

export interface ReportDiff {
  hasBaseline: boolean;
  metrics: MetricDelta[];
  casesFixed: string[];
  casesRegressed: string[];
  casesAdded: string[];
  casesRemoved: string[];
}

function delta(metricName: string, baseline: number | null | undefined, current: number | null | undefined): MetricDelta {
  const b = baseline ?? null;
  const c = current ?? null;
  return { metric: metricName, baseline: b, current: c, delta: b !== null && c !== null ? c - b : null };
}

export function diffAgainstBaseline(current: EvalReport, baseline: EvalReport | null): ReportDiff {
  if (!baseline) {
    return { hasBaseline: false, metrics: [], casesFixed: [], casesRegressed: [], casesAdded: [], casesRemoved: [] };
  }

  const metrics: MetricDelta[] = [delta("overall", baseline.overall.rate, current.overall.rate)];
  const tags = new Set([...Object.keys(baseline.byTag), ...Object.keys(current.byTag)]);
  for (const tag of [...tags].sort()) metrics.push(delta(tag, baseline.byTag[tag]?.rate, current.byTag[tag]?.rate));
  metrics.push(delta("contextRecall", baseline.retrieval.contextRecall, current.retrieval.contextRecall));
  metrics.push(delta("contextPrecision", baseline.retrieval.contextPrecision, current.retrieval.contextPrecision));
  metrics.push(delta("faithfulness", baseline.retrieval.faithfulness, current.retrieval.faithfulness));

  const baseById = new Map(baseline.cases.map((c) => [c.id, c.passed]));
  const currById = new Map(current.cases.map((c) => [c.id, c.passed]));

  const casesFixed: string[] = [];
  const casesRegressed: string[] = [];
  for (const [id, passed] of currById) {
    if (!baseById.has(id)) continue;
    const was = baseById.get(id);
    if (was === false && passed === true) casesFixed.push(id);
    if (was === true && passed === false) casesRegressed.push(id);
  }
  const casesAdded = [...currById.keys()].filter((id) => !baseById.has(id));
  const casesRemoved = [...baseById.keys()].filter((id) => !currById.has(id));

  return { hasBaseline: true, metrics, casesFixed, casesRegressed, casesAdded, casesRemoved };
}

export function renderDiffMarkdown(diff: ReportDiff): string {
  if (!diff.hasBaseline) return `No baseline stored — run with --update-baseline to create scripts/eval/baseline.json.`;

  const lines: string[] = [`## Diff vs baseline`, ``, `| Metric | Baseline | Current | Δ |`, `| --- | --- | --- | --- |`];
  for (const m of diff.metrics) {
    const arrow = m.delta === null ? "" : m.delta > 0 ? " ▲" : m.delta < 0 ? " ▼" : "";
    const d = m.delta === null ? "—" : `${m.delta >= 0 ? "+" : ""}${(m.delta * 100).toFixed(1)}pp${arrow}`;
    lines.push(`| ${m.metric} | ${metric(m.baseline)} | ${metric(m.current)} | ${d} |`);
  }
  lines.push(``);

  const bucket = (label: string, ids: string[]) => {
    if (ids.length > 0) lines.push(`**${label}:** ${ids.join(", ")}`, ``);
  };
  bucket("Fixed", diff.casesFixed);
  bucket("Regressed", diff.casesRegressed);
  bucket("Added", diff.casesAdded);
  bucket("Removed", diff.casesRemoved);

  return lines.join("\n").trimEnd();
}
