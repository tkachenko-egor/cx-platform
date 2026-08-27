# OSS adoption — implementation plan

Companion to [`01-oss-roadmap.md`](01-oss-roadmap.md). That doc says **why**
and sets scope boundaries; this doc is the **how** for each task, written
against the code as it stands on `main` at the time of writing so a future
session can pick up one task ID and run it without re-deriving the layout.

Rules unchanged from the roadmap:

- **One task per session.** Reference the task ID (`A1`, `B2`, …) in the
  commit and PR title.
- Touch only the files the task lists. If the change wants to spread, the
  task was mis-scoped — stop and say so.
- Definition of Done for every task:

  ```
  npm test && npm run typecheck && npm run lint && npm run eval
  ```

  Plus `npm run seed` against the real `cx-platform.db` for any task that
  touches `src/db/schema.sql` or `src/db/migrations/`.

## Recommended order

1. **A1** first (roadmap says so — B2/B3 must preserve the rerank stage).
2. Rest of Phase A in any order: **A2**, **A3**, **A4**, **A5**. A6/A7 optional.
3. Phase B strictly in sequence: **B0 → B1 (+B4) → B2 → B3 → B5 → B6**.
   B6 optional; B4 lands together with B1.

Phase A ships on the current SQLite build. Nothing in Phase A depends on
Phase B.

---

## Status

**Phase A (A1–A7): all shipped**, one commit per task, each on its own
branch (`a1-cross-encoder-rerank` → `a7-eval-reporting`, stacked). Full
gate green at the tip: `npm test` (266), `typecheck`, `lint` (0 errors),
`npm run eval` (15/15).

**Phase B — B0: done** on branch `b0-async-data-layer`, five commits
(`B0 (1/5)` … `B0 (5/5)`). Every repository method is `async` and every
call site `await`s; `better-sqlite3` still underneath, `createDb`/`getDb`/
migrations still synchronous, no schema change. The three `db.transaction()`
sites (`kb-repository`, `provider-credential-repository`,
`commerce/seed-data`) are commented `// B1: real async tx, pinned pooled
client`. Diverged from the plan below: the async ripple reached raw-SQL
helpers outside `src/db/repositories/` too — `src/analytics/*`,
`src/core/{sla,state-transition}`, `src/channel/{turn,feedback,email/threading}`,
`src/tools/commerce/*` handlers — all now async. `AuditLogRepository` landed
with the C4 conversation cluster rather than C1 (it is used from ~25 route
files). Full gate green: `npm test` (266), `typecheck`, `lint` (0 errors),
`npm run eval` (15/15, zero baseline movement), `npm run seed`.
**B1 is next** — do not start it until B0 is merged.

Where the implementation diverged from the plan below:

- **A2** — kept `checkPiiLeakage` / `checkOutputGuardrails` *synchronous*
  instead of the predicted async ripple. The one Presidio HTTP call is
  made in `runtime.ts`; resolved spans are passed down. No SDK — raw
  fetch (`PRESIDIO_URL`).
- **A3** — `contextRecall` / `contextPrecision` are deterministic and
  gated. **Faithfulness is plumbed but always reported "skipped"**:
  computing it needs a judge model *and* retrieved-chunk-text threaded
  through `runAgentTurn` (out of A3's file scope). Verified: `KB_TOP_K=1`
  fails the gate on context recall.
- **A4** — added `INJECTION_PATTERNS` (4 regexes) alongside the string
  list for the override/exfiltration families; despaced matching for
  markers ≥12 chars.
- **A5** — Docling via a raw-fetch sidecar (`DOCLING_URL`), `pdf-parse`
  kept as the offline fallback. `chunkMarkdown` now splits on any H2+
  heading (was H2-only); `.md` KB output unchanged. `.gitattributes`
  added (`*.pdf binary`) for the fixture.
- **A6** — OTLP/HTTP JSON built by hand, **no OpenTelemetry SDK
  dependency** (house style). Touched `gateway.ts` + `registry.ts` (one
  line each) so the exported span tree actually carries tokens/cost and a
  span per tool call — the roadmap's "no call sites change" could not
  co-exist with its "spans covering … each tool call" acceptance.
- **A7** — `scripts/eval/report.ts` + `baseline.json`; `npm run eval`
  now writes `report.latest.{json,md}` (git-ignored) and prints a
  baseline diff. `npm run eval:baseline` promotes a run.

---

## Current-state notes that every task depends on

- **`createDb(location)`** (`src/db/client.ts`) loads `schema.sql`
  (`CREATE TABLE IF NOT EXISTS`) then runs `ALL_MIGRATIONS` in order.
  Fresh DB (`:memory:` in every test) gets the final shape from `schema.sql`;
  migrations only do real work against a pre-existing file. Migration
  template: [`029-platform-owner-tenant.ts`] / `027-agent-tool-settings.ts`
  — `PRAGMA table_info` guard, then `ALTER TABLE ADD COLUMN … DEFAULT`.
- **`agent_defs` config** is JSON columns (`kb_scope`, `guardrails`,
  `escalation_config`, `tool_settings`, …). At the repository boundary they
  are `Record<string, unknown>`; the typed shape lives at the consuming
  layer (`KbScope` in `src/kb/retrieval.ts`, `AgentGuardrailConfig` in
  `src/guardrails/types.ts`). **Adding a sub-key to an existing JSON column
  needs no migration** — only a new *column* does.
- **Provider abstraction pattern** (`src/gateway/embeddings/`): `types.ts`
  interface, one real impl, one deterministic stub for tests. Copy this
  shape for A1's reranker.
- **Invariant #1** (no provider SDK past the gateway boundary, enforced by
  `eslint.config.mjs` `no-restricted-imports`) is not threatened by A1/A2/A5
  — Presidio, Docling and the reranker are HTTP sidecars, no SDK import.
- **`npm test` / `npm run eval` are network-free** (NFR-9.5). Every task
  that adds a service call must have an offline path that is the default in
  tests: stub provider, or env-gated skip.
- Guardrail runner functions (`src/guardrails/runner.ts`) are **synchronous
  today**. A2 makes the output path async; A4 stays sync.

---

# Phase A

## A1 — Cross-encoder rerank after RRF

**Goal:** insert an optional per-agent rerank stage between RRF fusion and
the `limit` truncation in `hybridSearch()`, defaulting off, degrading to
today's behaviour when the reranker is absent or errors.

**Files:**
- `src/kb/retrieval.ts` — the rerank call inside `hybridSearch()`.
- `src/gateway/rerank/{types,stub,<impl>}.ts` — **new**. Interface +
  deterministic stub + one real implementation (HTTP call to a
  `bge-reranker-v2-m3` / FlashRank sidecar; URL from env).
- `src/agents/runtime.ts` — pass the reranker + read the per-agent flag;
  extend the `kb_retrieval_log` write.
- `src/db/schema.sql` + new migration — `kb_retrieval_log.reranked` column.
- `src/db/repositories/kb-retrieval-log-repository.ts` — carry `reranked`
  through `record()` and `KbRetrievalLogEntry`.
- `tests/kb.test.ts` — new cases.

**Config:** add to `KbScope` (lives in `kb_scope`, no migration):

```ts
export interface KbScope {
  audience?: string[];
  collectionIds?: string[];
  rerank?: { enabled: boolean; model?: string }; // default: absent = off
}
```

**Steps:**
1. New `RerankProvider` interface: `rerank(query, candidates: {id, text}[])
   → {id, score}[]` (ordered). Stub returns candidates reordered by a
   deterministic function of `(query, text)` overlap so a test can assert a
   specific reordering. Real impl: `fetch(RERANKER_URL, …)`, throws on
   non-200 / network error.
2. `hybridSearch()` signature **unchanged** — thread the provider in as an
   optional param with a default, or via a small options object at the end.
   Confirm no caller needs to move (only call site:
   `src/agents/runtime.ts:175`).
3. Over-fetch: after fusion, keep ~50 (`RERANK_CANDIDATE_POOL`) instead of
   slicing to `limit`.
4. If `kbScope.rerank?.enabled` and a provider is present: `try` rerank the
   pool, then slice to `limit`; `catch` → log, fall back to the un-reranked
   fused order sliced to `limit`. If disabled/absent → today's path exactly.
5. `runtime.ts`: construct the provider from env (stub when unset), pass it
   down. Record `reranked: boolean` (did the stage actually run and
   succeed) on the `kb_retrieval_log` row.
6. Migration: `ALTER TABLE kb_retrieval_log ADD COLUMN reranked INTEGER NOT
   NULL DEFAULT 0`; mirror in `schema.sql`. Run `npm run seed` on the real
   DB.

**Tests (acceptance):**
- Candidate set where RRF puts the right chunk 2nd; stub reranker (rigged
  for that fixture) promotes it to 1st. Assert order changed.
- Provider that throws → `hybridSearch()` returns the exact RRF order,
  no exception.
- `rerank.enabled` absent → byte-identical result to pre-change (snapshot
  the existing test's expectation).
- A retrieval-log assertion that `reranked` is `1` when it ran, `0` otherwise.

**Risks / invariants:** no hardcoded model string (invariant #3-adjacent) —
`rerank.model` is agent config, the URL is env. Keep the marker/threshold
constants (`RERANK_CANDIDATE_POOL`) named and at module top.

**Effort:** M (one new module, one migration, ~4 tests).

---

## A2 — Typed PII detection in the output guardrail

**Goal:** back `checkPiiLeakage()` with a Presidio sidecar for typed entity
detection (cards, IBAN, national ID, addresses, names), keeping the two
existing regexes as the offline fallback and the `"block" | "redact"`
contract unchanged.

**Files:**
- `src/guardrails/output.ts` — `checkPiiLeakage` becomes async, calls
  Presidio, falls back to regex.
- `src/guardrails/runner.ts` — `checkOutputGuardrails` becomes async (it
  already `merge`s results; now `await`s the PII check).
- `src/guardrails/types.ts` — `AgentGuardrailConfig.output` gains
  `piiEntities?: { allow?: string[]; deny?: string[] }` (no shape change to
  `piiMode`).
- `src/agents/runtime.ts` — the one output-guardrail call site becomes
  `await` (grep `checkOutputGuardrails`).
- A new `src/guardrails/presidio.ts` client module (HTTP, env URL).
- `tests/guardrails.test.ts`.

**Steps:**
1. `presidio.ts`: `analyze(text, entities?)` → `{entityType, start, end,
   score}[]` via `POST /analyze`; `anonymize(text, results)` →
   redacted string via `POST /anonymize`. Both throw on unreachable.
2. `checkPiiLeakage(assistantText, toolResultsText, mode, opts?)`:
   - `try` Presidio: analyze `assistantText`; drop any span whose exact
     substring appears in `toolResultsText` (unchanged attribution rule);
     remaining spans → `reasons`. For `redact`, use Presidio `anonymize`
     for `redactedText`; for `block`, `blocked: true`.
   - `catch` → run today's `EMAIL_PATTERN` / `PHONE_PATTERN` logic verbatim,
     push a `pii_check_degraded:service_unreachable` reason-note (or emit a
     trace/console line — do not silently pass), still return a real result.
3. Entity allow/deny from `config.output.piiEntities` → passed as the
   `entities` arg; deny filters the result set post-analyze.
4. Thread `async` up through `checkOutputGuardrails` → `runtime.ts`. This is
   the only ripple; the input/chunk guardrails stay sync.

**Tests (acceptance):**
- Card number, IBAN, person name in an unattributed reply → all three in
  `reasons` (mock Presidio client returns those spans).
- PII that *is* present verbatim in `toolResultsText` → passes (attribution
  unchanged).
- Presidio client throws → falls back to regex, result still returned,
  degradation logged, no throw.
- `redact` mode with mocked `anonymize` → `redactedText` set, `blocked:false`.

**Risks:** the async conversion of `checkOutputGuardrails` — check every
caller (`runtime.ts`, any test helper). Presidio's default recognizers are
locale-sensitive; don't bake a locale — if per-locale is needed later it's
another `piiEntities`-style config key, not a constant.

**Effort:** M–L (async ripple is the cost, not the logic).

---

## A3 — Retrieval metrics in the eval gate

**Goal:** add context-precision, context-recall and faithfulness to
`npm run eval`, gated by `thresholds.json`, computed from expected-chunk
annotations on golden turns; model-dependent metrics skip cleanly offline.

**Files:**
- `scripts/eval/scoring.ts` — new metric computation + `EvalSummary`
  extension.
- `scripts/eval/run-eval.ts` — expose retrieved doc/chunk ids per turn;
  wire the new metrics into the summary + gate print.
- `scripts/eval/thresholds.json` — new keys.
- `tests/eval-runner.test.ts` — unit cases for the new pure functions.
- `tests/eval/golden-conversations.json` — `expectedChunks` /
  `expectedRetrievedDocs` on turns that retrieve.

**Steps:**
1. `GoldenTurn` gains `expectedRetrievedDocs?: string[]` (doc-id level —
   deterministic, no model). Keep it optional; only annotate retrieving turns.
2. `TurnOutcome` gains `retrievedDocs: string[]`. `run-eval.ts` currently
   only surfaces `citableDocs` from the turn result — extend
   `processInboundTurn`'s return (or read the `kb_retrieval_log` row it
   just wrote) to get the full retrieved set per turn.
3. In `scoring.ts` add **pure** functions:
   - `contextRecall(expected, retrieved)` = |expected ∩ retrieved| /
     |expected|.
   - `contextPrecision(expected, retrieved)` = |expected ∩ retrieved| /
     |retrieved|.
   - `faithfulness(...)` — **model-dependent**; signature takes an optional
     judge callback. When absent → return `null`/skip.
4. `EvalSummary` gains a `retrieval: { contextRecall, contextPrecision,
   faithfulness: number | null }` block (mean over annotated turns).
   `summarize()` signature changes — update `tests/eval-runner.test.ts`.
5. `checkThresholds()` reads `thresholds.json` keys
   `contextRecall` / `contextPrecision` / `faithfulness`; a `null`
   (skipped) metric is treated like today's "zero matching cases" —
   vacuously fine, with a printed `skipped (no judge model configured)`.
6. Faithfulness judge runs **through the gateway with a pinned alias**
   (`seedFixtures` already registers one alias per catalog model). Gate the
   whole judge path on an env flag (`EVAL_JUDGE_ALIAS`); default unset →
   `npm test` and offline `npm run eval` stay network-free.

**Tests (acceptance):**
- Degrade retrieval in a golden run (`limit=1`, or stub out the keyword
  half) → `contextRecall` drops below threshold → `npm run eval` exits 1.
- No `EVAL_JUDGE_ALIAS` → eval completes, faithfulness line reads
  `skipped`, gate still enforced on the deterministic metrics.

**Risks:** `summarize()` is used by `tests/eval-runner.test.ts` — its
signature/return change is the main blast radius. Keep the existing
`overall` / `byTag` fields intact and *add* `retrieval` alongside.

**Effort:** L (touches the scoring contract + golden data + runner plumbing).

---

## A4 — Wider prompt-injection coverage

**Goal:** expand `INJECTION_MARKERS` from LLM Guard's pattern set, keep the
scan deterministic and pre-model, add normalisation so inserted whitespace
doesn't evade the match.

**Files:**
- `src/guardrails/input.ts` — marker list (as data) + normalisation in
  `scanForPromptInjection`.
- `tests/guardrails.test.ts`.
- Optionally split the list into `src/guardrails/injection-markers.ts` so it
  reviews as a plain list (the roadmap suggests this).

**Steps:**
1. Port LLM Guard prompt-injection + jailbreak scanner substrings/patterns
   as a plain string (or `RegExp`) array. Keep a comment block crediting LLM
   Guard (MIT) for verbatim patterns.
2. Normalise before matching: lowercase (already), collapse runs of
   whitespace to a single space, strip zero-width chars, optionally
   de-leet. Apply the same normalisation to the marker list at module load.
3. Keep `scanForPromptInjection` returning `{hit, matched?}` — no signature
   change. It stays sync. Both call sites (`checkUserInputGuardrails`,
   `checkRetrievedChunkGuardrails`) are unaffected.

**Tests (acceptance):**
- A corpus of known injection strings (incl. whitespace-spaced
  `i g n o r e   previous…`) all return `hit: true`.
- A corpus of benign messages containing "ignore", "system", "prompt" in
  ordinary use → all `hit: false` (guard against false positives).
- Existing test that the scan runs on every retrieved chunk still passes.

**Risks:** false-positive rate is the real hazard — the benign corpus is
part of the acceptance, not optional. Don't import LLM Guard as a
dependency (it's Python); this is a data port only.

**Effort:** S–M.

---

## A5 — Layout-aware document ingestion

**Goal:** replace `pdf-parse` with a Docling sidecar that preserves heading
levels and table structure, keeping the string interface `chunking.ts`
consumes and adding structure where Docling provides it.

**Files:**
- `src/kb/pdf-extract.ts` — new extractor (HTTP call to Docling sidecar),
  same `extractPdfText(Buffer) → Promise<string>` entry, plus an extended
  variant returning structure.
- `src/kb/chunking.ts` — consume heading level / table markers when present;
  `chunkMarkdown` already splits on `##` and keeps tables whole, so the win
  is feeding it clean structured Markdown.
- `scripts/ingest-kb.ts` — no signature change; note the re-index need.
- `tests/kb.test.ts` + `tests/fixtures/` — a fixture PDF with headings and a
  table.

**Steps:**
1. Docling sidecar (`POST /convert` → Markdown/JSON). New client module;
   env URL; on unreachable, either fall back to `pdf-parse` (keep it as a
   dependency for this) or fail the ingest loudly — decide and document.
2. Keep `extractPdfText` returning a plain Markdown string (Docling's
   Markdown export). `chunkMarkdown` then sees real `##` headings and pipe
   tables instead of flattened text.
3. If extending the interface with heading level / table metadata, add a
   second function (`extractPdfStructured`) rather than changing the
   existing return type — fewer callers move.
4. **Data migration:** re-ingestion of existing tenant KBs is explicit.
   Document a `npm run ingest-kb` re-run (content hash changes → re-chunk /
   re-embed). Do not change retrieval for existing tenants silently.

**Tests (acceptance):**
- Fixture PDF with headings + a table → chunks preserve both (assert a
  chunk `heading` matches, assert a chunk `text` contains the table rows).
- Existing markdown-fixture chunk counts and citation resolution unchanged
  or improved; `npm run eval` does not regress.

**Risks:** the offline story — `npm test` must not need the Docling
service. Keep a stub/fallback path and use it in tests. Fixture PDF must be
committed and small.

**Effort:** M.

---

## A6 — Portable trace export *(optional)*

**Goal:** an opt-in OpenTelemetry exporter behind `emitTrace()`, emitting
GenAI-semantic-convention spans *in addition to* the existing in-app events,
no call sites changed.

**Files:**
- `src/tracing/trace.ts` — after the existing `console.log`, fan out to the
  exporter when configured.
- `src/tracing/otel-exporter.ts` — **new**. OTLP export; no-op when unconfigured.

**Steps:**
1. `emitTrace` keeps its exact current behaviour (the `console.log` line).
   Add: if `OTEL_EXPORTER_OTLP_ENDPOINT` (or an app-specific flag) is set,
   also build and export a span.
2. Map trace events → GenAI spans: model, tokens (`usage`), `cost_usd`,
   latency, tool calls. Tenant id as a span attribute
   (`tenant.id`) — review the event `data` for anything else
   tenant-sensitive before it goes on a span.
3. Absent config → zero network, zero behaviour change.

**Tests (acceptance):**
- No exporter configured → `npm test` and desk trace-panel output
  byte-identical (existing trace tests unchanged).
- With a mock collector → a chat turn produces a span tree covering the
  model call and each tool call.

**Risks:** OTel SDK pulls transitive deps; keep the exporter module the only
thing that imports it, lazy-import it so the unconfigured path never loads it.

**Effort:** M.

---

## A7 — Eval reporting and baseline diff *(optional)*

**Goal:** wrap `run-eval.ts` output into a shareable report + a diff against
a stored baseline. Reporting only — `processInboundTurn` stays the thing
under test, `checkThresholds()` stays the gate.

**Files:** `scripts/eval/` only (e.g. `scripts/eval/report.ts`,
`scripts/eval/baseline.json`).

**Steps:**
1. After `summarize()`, serialise the summary to a report file (JSON +
   a human-readable md/html).
2. `baseline.json` holds a committed prior summary; print a per-metric delta.
3. Optionally adopt promptfoo's report format for familiarity — but do not
   route case execution through promptfoo.

**Acceptance:** a run produces a report + a baseline diff; CI gate still
comes from `checkThresholds()`.

**Effort:** S. Stop immediately if it starts changing how cases execute.

---

# Phase B — SQLite → Postgres

Measured scope: ~221 `.prepare(` sites, ~93 files importing `better-sqlite3`,
2 `json_extract`/`INSERT OR REPLACE` sites in `src/` (roadmap says 5 outside
FTS — check `app/` too), 29 migrations, `schema.sql` 715 lines, 39 test
suites on the `:memory:` path.

## B0 — Make the data layer async, still on SQLite

**Goal:** every repository method `async`, every call site `await`,
`better-sqlite3` still underneath, zero behaviour change.

**Files:** `src/tenancy/repository.ts`, all of `src/db/repositories/`, and
every caller up the chain: `src/tools/registry.ts`, `src/agents/runtime.ts`,
`src/channel/turn.ts`, `app/api/**`, `scripts/eval/run-eval.ts`, tests.

**Steps:**
1. Repository by repository. For each: make methods `async` (wrap the
   synchronous `better-sqlite3` calls — they stay sync internally, the
   method just returns a resolved promise), then fix every caller to
   `await`, then run the suite. Commit-sized chunks *within* the one PR, or
   genuinely one repo per session if it's too big — flag that at the start.
2. `TenantScopedRepository` constructor stays sync (it just stores
   `tenantId`). Invariant #2 holds: `TenantContext` stays a constructor
   arg, no method gains a `tenantId` param.
3. Watch for repositories constructed inline in hot paths
   (`new KbRetrievalLogRepository(...).record(...)`) — those `record` calls
   become `await`.
4. React Server Components / API routes in `app/` — already async, just add
   `await`.

**Acceptance:** no `Database.Database` type outside `src/db/`. Full gate
passes. Eval output identical.

**Risks:** this is the biggest single task in the doc. If it can't land in
one session, the honest move is to say so and do it repo-group by
repo-group across sessions, each keeping the suite green. Do **not** start
B1 until B0 is fully merged.

**Effort:** XL.

## B1 — Swap the engine

**Component:** `pg` (MIT) or `postgres.js` (Unlicense); optionally Kysely
(MIT).

**Files:** `src/db/client.ts`, `src/db/migrate.ts`, `src/db/schema.sql`,
`src/db/migrations/`, `src/tenancy/repository.ts`. Lands **with B4**.

**Steps:**
1. Connection pool replaces the single `Database` handle in `client.ts`.
   `getDb()` singleton → a pool; `createDb()` → pool + bootstrap.
2. Dialect fixes (only a handful): `json_extract`/`json_each` → `->>` /
   `jsonb_array_elements`; `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`
   (note `agent-def-repository.ts`'s `saveDraft` already uses
   `ON CONFLICT` syntax — verify it's PG-compatible).
3. Type upgrade while rewriting schema: real `boolean` (drop the `=== 1`
   dance in `rowToAgentDef` etc.), `timestamptz`, `jsonb`.
4. **Bootstrap decision (make it explicitly, update `CLAUDE.md`):** either
   (a) keep `schema.sql` + migrations as a pair with a written rule for
   which owns what, or (b) squash to a single baseline migration and delete
   `schema.sql`. Recommendation: **(b)** — the `CREATE TABLE IF NOT EXISTS`
   no-op hazard `CLAUDE.md` warns about is SQLite-shaped and goes away with
   a migrations-only model.
5. Transactions must pin one pooled client for their whole life
   (`migrate.ts`'s `db.transaction(...)` wrapper → a checked-out client).
   This is the most likely bug source — the sync code never had to think
   about it.
6. `src/core/clock.ts` still owns time — no `now()` in SQL for
   business/eligibility logic (invariant #6).

**Acceptance:** full gate against Postgres; `npm run seed` builds a working
DB from scratch; `tests/gateway-swap.test.ts` + tenancy suite unchanged in
intent.

**Effort:** XL.

## B4 — Keep tests dependency-free (lands with B1)

**Component:** PGlite (Apache-2.0 / PostgreSQL).

**Files:** `src/db/client.ts`, `src/testing/`.

**Steps:** the `":memory:"` branch of `createDb()` → PGlite in-process
(supports pgvector, so B2's KB tests stay real). Everything else in
`src/testing/seed-fixtures.ts` is engine-agnostic already.

**Acceptance:** `npm test` green, no external services, no Docker.

**Effort:** M — but non-negotiable to land with B1 (a migration that leaves
the suite needing a live server has broken NFR-9.5).

## B2 — pgvector for dense retrieval

**Files:** `src/kb/retrieval.ts`, `src/kb/ingest.ts`, schema/migration.

**Steps:** `CREATE EXTENSION vector`; `kb_chunks.embedding` → `vector(N)`
with an HNSW index. Retire `cosineSimilarity()` and the full-scan sort in
`hybridSearch()` — dense ordering moves into SQL (`ORDER BY embedding <=>
$1 LIMIT 20`). **If A1 landed:** the rerank stage stays exactly where it is,
now fed by the indexed candidate pool. `KbChunkRepository` grows a
`nearest(queryVector, limit)` method.

**Acceptance:** KB tests pass against pgvector; fixture-corpus ordering
matches pre-migration (modulo ANN recall); `npm run eval` no regression.

**Effort:** M.

## B3 — Postgres full-text search

**Files:** `src/kb/retrieval.ts`, schema/migration.

**Steps:** `kb_chunks_fts` (fts5) → a `tsvector` column on `kb_chunks` with
a GIN index. `toFtsQuery()` → `websearch_to_tsquery`; rank with
`ts_rank_cd`; **same RRF fusion, same `RRF_K = 60`**. Wire the text-search
config to the agent language field (migration 022) — `english` covers
today's porter stemming, don't hardcode it. Preserve `kb_scope` audience /
collection filtering (FR-7.4/7.6/7.7) — it runs before both rankings today
and must still.

**Acceptance:** keyword-half results equivalent or better on the fixture
corpus; `kb_scope` filtering preserved. Fusing dense+keyword into one query
is allowed only if it doesn't obscure the fusion logic.

**Effort:** M.

## B5 — Row-level security as a tenancy backstop

**Files:** schema/migration, `src/db/client.ts`, `src/tenancy/repository.ts`.

**Steps:** RLS policies on every tenant-scoped table; `SET LOCAL
app.tenant_id = $1` issued on each pooled-connection checkout, from the
tenant context. The platform-owner path (migration 029) gets a **deliberate,
documented** exemption (a `BYPASSRLS` role or an explicit policy carve-out),
not an accidental bypass.

**Acceptance:** a test proves tenant A's repo can't read tenant B's rows
*even with the WHERE clause removed*. The platform-admin path still works,
covered by its own test.

**Effort:** M–L (the connection-checkout hook is the fiddly part).

## B6 — Durable session store *(optional)*

**Files:** `src/agents/sessions-store.ts`, schema/migration.

**Steps:** the in-memory `Map` in `sessions-store.ts` → a
`agent_sessions` table, full gateway-shape turn history
(`tool_use`/`tool_result` blocks) in `jsonb`, tenant-scoped. **Keep the
`getOrCreateSession` interface** so `src/agents/runtime.ts` doesn't change
(it may need to become async — check). Add a retention/cleanup job — this
table grows unbounded otherwise.

**Acceptance:** two processes against one DB serve alternating turns of one
conversation. Remove invariant #8 from `CLAUDE.md`.

**Effort:** M.

---

## Per-task checklist template

```
- [ ] Branch: <taskid>-<slug>
- [ ] Only the files the task lists are touched
- [ ] New config is agent_defs data, not a constant (invariants #3/#4/#5)
- [ ] Offline/degraded path is the default in tests (NFR-9.5)
- [ ] npm test
- [ ] npm run typecheck
- [ ] npm run lint
- [ ] npm run eval
- [ ] npm run seed against real cx-platform.db  (only if schema/migrations touched)
- [ ] CLAUDE.md updated  (B1 bootstrap decision; B6 invariant #8 removal)
- [ ] Commit + PR title reference the task ID
```
