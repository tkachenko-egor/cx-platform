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
3. Phase B strictly in sequence: **B0 → B1 → B2 → B3 → B5 → B6**.
   B6 optional. **B4 was folded into B1** — the decision was a real Postgres
   in the test loop (Docker / CI service container), not PGlite, so there is
   no separate "keep tests dependency-free" task; the disposable-database
   harness ships as part of B1.

Phase A ships on the current SQLite build. Nothing in Phase A depends on
Phase B.

> **Note (post-B1):** the SQLite statements below are historical. B1 replaced
> the engine with Postgres, squashed `schema.sql` + all 30 migrations into
> `src/db/migrations/000-baseline.ts`, and moved every repository onto the
> `SqlDatabase` surface in `src/db/pg.ts`. B2/B3/B5/B6 build on that; where
> they still say "SQLite" read "the pre-B1 state".

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

**Phase B — B1 (+B4): done** on branch `b1-postgres-engine`. Engine is now
`pg` (node-postgres) against real Postgres (pgvector image), wrapped by
`SqlDatabase` in `src/db/pg.ts` — the old `db.prepare(sql).get/all/run`
surface, but async, with `?`→`$n` translation, `jsonb`/`boolean` native,
`timestamptz` handed back as ISO strings, and `db.tx()` pinning one pooled
client. `schema.sql` + all 30 migrations squashed into
`src/db/migrations/000-baseline.ts` (type upgrade taken: `jsonb`,
`boolean`, `timestamptz`, `double precision`; commerce dates stay `text`).
fts5 → a `tsvector` generated column + GIN with `ts_rank_cd` ranking (a lean
pull-forward of B3). **B4 folded in**: `createDb(":memory:")` clones a
disposable database from a migrated template built by
`src/testing/global-setup.ts`; `docker compose up -d db` for local/CI, no
PGlite. Divergences from the plan: (a) `SELECT … AS "camelCase"` aliases had
to be quoted (Postgres folds unquoted identifiers) — 6 sites; (b) `pg`
returns aggregates as strings — neutralised with global type parsers in
`pg.ts`; (c) `getEphemeralDb` keeps `createDb` synchronous via a deferred
`#gate` so ~100 test call sites didn't move.

**Phase B — B2: done** on branch `b2-pgvector-dense-retrieval`.
`kb_chunks.embedding` `jsonb` → pgvector `vector` (migration `001`); the dense
half of `hybridSearch` ranks in SQL via `KbChunkRepository.nearest`
(`embedding <=> $1::vector`) instead of a JS `cosineSimilarity` full scan.
Column left unsized (dimension is provider-dependent), exact KNN, no ANN
index — see the B2 section below. Gate green: `npm test` 267, `eval` 15/15
(zero movement — ordering is identical).

**Phase B — B3: done** on branch `b3-postgres-fts-per-language` (stacked on
B2). Keyword search is now per-agent-language: `KbChunkRepository.searchKeyword`
takes a Postgres text-search config resolved from `agent_defs.language_config`
by `src/kb/text-search-config.ts` (→ `'english'` default, `'simple'` for
languages Postgres has no stemmer for). Migration `002` drops the hardcoded
`fts` generated column for a query-time `to_tsvector(<config>, text)` + an
`'english'` expression index. Gate green: `npm test` 270, `eval` 15/15
(english byte-identical).

**Phase B — B5: done** on branch `b5-row-level-security` (stacked on B3).
RLS + `FORCE` on all 34 `tenant_id` tables; `TenantScopedRepository`'s `db` is
a `SqlDatabase.forTenant()` handle that runs every query in a tx with
`SET LOCAL ROLE cx_tenant` (non-superuser — `cx` is a superuser and would
bypass RLS) + `set_config('app.tenant_id', …)`. Unscoped paths stay on the
root superuser handle (the deliberate exemption). Migration `003`. Gate green:
`npm test` 271, `eval` 15/15. **B6 (optional) is next / last.**

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

## B1 (+B4) — Swap the engine → **DONE**

**Component:** `pg` (MIT), against real Postgres (`pgvector/pgvector:pg17`).
No `postgres.js`, no Kysely, **no PGlite** — the decision was a real Postgres
in the test loop, so B4 has no separate existence.

**What shipped** (branch `b1-postgres-engine`):

1. **`src/db/pg.ts`** — `SqlDatabase`, the `better-sqlite3`-shaped surface B0
   left behind (`prepare(sql).get/all/run`, `exec`), now async over a
   `pg.Pool`. `?`→`$n` translation at `prepare()` time. `db.tx(async q => …)`
   pins one pooled client for a transaction. Global `pg` type parsers:
   `int8`/`numeric` → `Number`, `timestamptz` → ISO string. `fromJson()`
   helper for the `jsonb` read path.
2. **`src/db/client.ts`** — `getDb()` → pooled singleton;
   `createDb(":memory:")` clones a throwaway `cx_test_<uuid>` from a migrated
   template (`buildTemplateDatabase` / `dropTestDatabases`), staying
   synchronous via a deferred bootstrap gate so ~100 test call sites didn't
   move. `src/testing/global-setup.ts` builds/drops the template per run;
   `scripts/eval/run-eval.ts` does the same inline.
3. **Squash** — `schema.sql` + all 30 migrations → `000-baseline.ts` (pure
   Postgres DDL). `migrate.ts` is async, one tx per migration. **`CLAUDE.md`
   updated**: migrations-only, no `schema.sql`.
4. **Type upgrade taken:** `jsonb`, `boolean`, `timestamptz`,
   `double precision`, pgvector extension present (embedding stayed `jsonb`
   until B2, now `vector`). Commerce dates + `kb_articles.effective`
   deliberately stay `text` (string-compared against `today()`, invariant #6).
5. **Dialect fixes:** `json_extract(metadata,'$.x')` → `metadata->>'x'`;
   `macros … LIKE` → `ILIKE`; `SELECT … AS "camelCase"` quoted (6 sites —
   Postgres folds unquoted identifiers to lowercase). No `INSERT OR REPLACE`
   existed; the two `ON CONFLICT` upserts were already PG-valid.
6. **Transactions:** the 3 `db.transaction()` sites (`kb-repository`,
   `provider-credential-repository`, `commerce/seed-data`) + `migrate.ts`
   now use `db.tx()`. `seedCommerceBusinessData` became async.
7. **fts5 → `tsvector`** (lean B3 pull-forward, unavoidable): `kb_chunks.fts`
   generated column + GIN, `searchKeyword` ranks with `ts_rank_cd` /
   `websearch_to_tsquery('english', …)`; `toFtsQuery()` deleted.
8. **Infra:** `docker-compose.yml` (`pgvector/pgvector:pg17`, durability off
   — the DB is disposable), CI `services.db`, `.env(.example)` →
   `DATABASE_URL` / `TEST_DATABASE_URL`. `better-sqlite3` removed;
   `no-restricted-imports` now blocks it and `pg` (except `src/db/pg.ts`).

**Gate:** `npm test` 266/266, `typecheck`, `lint` (0 errors),
`npm run eval` 15/15 (contextPrecision +16.7pp from the tsvector swap — an
improvement, not a regression), `npm run seed`.

**Bug found along the way:** B0 had left three unawaited repo calls in
`seed-fixtures.ts` (`agents.publish`, `toolDefs.upsert`) — invisible with
synchronous SQLite, a race with real async. Now awaited.

## B2 — pgvector for dense retrieval → **DONE**

**What shipped** (branch `b2-pgvector-dense-retrieval`):

1. **Migration `001-pgvector-kb-chunks-embedding.ts`** — `kb_chunks.embedding`
   `jsonb` → pgvector `vector`, via `ALTER COLUMN … TYPE vector USING
   embedding::text::vector` (a jsonb array renders as `[1,2,3]`, exactly
   pgvector's text input). Idempotent (guarded on `data_type = 'jsonb'`).
   Extension was already `CREATE`d in `000-baseline`.
2. **`KbChunkRepository.nearest(queryVector, limit, candidateChunkIds)`** —
   dense ranking in SQL: `ORDER BY embedding <=> $1::vector`, restricted to the
   passed candidate ids so the kb_scope (collection / audience) filter still
   runs before ranking, exactly mirroring how `searchKeyword` returns ranked
   ids over the same set. `rowToChunk` gained a `parseVector` (pgvector hands
   `vector` back as text); the `replaceForArticle` INSERT casts `?::vector`.
3. **`hybridSearch()`** — the JS `cosineSimilarity` full-table sort is gone;
   the dense half is now `chunkRepo.nearest(...)`. `<=>` cosine distance =
   `1 − cosine similarity`, so the ordering is *identical*, not "modulo ANN".
   The A1 rerank stage is untouched — still fed by the RRF-fused pool.

**Divergences from the plan above:**

- **Unsized `vector` column, no HNSW index.** The embedding dimension is
  provider-dependent (32 for the test stub, 1536 for OpenAI
  `text-embedding-3-small`) and pgvector's ANN indexes need a fixed typmod, so
  a baked-in `vector(N)` would break one deployment or the other. Exact `<=>`
  KNN is correct (zero recall loss) and faster than the prior JS scan at this
  corpus size. A deployment that has locked its embedding model adds an HNSW
  index in a one-line follow-up migration (`CREATE INDEX … USING hnsw
  ((embedding::vector(1536)) vector_cosine_ops)`).
- **`cosineSimilarity()` kept, not retired** — still used by
  `src/kb/semantic-cache.ts` (out of B2's file scope; a handful of cached
  query vectors compared in-process).
- **`src/kb/ingest.ts` untouched** — embedding serialization is entirely
  inside `KbChunkRepository`; the existing `JSON.stringify(array)` form is
  valid pgvector input, only the `::vector` cast in the INSERT was needed.

**Gate:** `npm test` 267/267, `typecheck`, `lint` (0 errors), `npm run eval`
15/15 (no movement vs B1 — dense ordering is byte-identical), `npm run seed`
(migration `001` verified applied + column converted on the real dev DB).

## B3 — Postgres full-text search (per-language config) → **DONE**

**What shipped** (branch `b3-postgres-fts-per-language`, stacked on B2):

1. **`src/kb/text-search-config.ts`** (new) — `resolveTextSearchConfig(language?)`
   maps `agent_defs.language_config`'s free text (the admin editor field is a
   plain input, placeholder "e.g. Ukrainian") to one of Postgres's 29 built-in
   `regconfig`s. Nothing configured → `'english'` (pre-B3 behaviour);
   recognised name / ISO-639-1 code / common endonym → its config; anything
   else — including languages Postgres ships no stemmer for, like Ukrainian —
   → `'simple'` (lowercase + split, never a *wrong* stemming).
2. **Migration `002-kb-chunks-fts-per-language.ts`** — drops the `kb_chunks.fts`
   generated column + `idx_kb_chunks_fts`. It was hardcoded `'english'` and
   couldn't be per-agent: one KB collection feeds agents in different
   languages, so the search language is a *query-time* property. Adds a GIN
   *expression* index `to_tsvector('english', text)` so the common/default
   path stays index-backed; other languages do an on-the-fly tsvector scan
   (fine at this corpus size).
3. **`KbChunkRepository.searchKeyword(query, limit, config = 'english')`** —
   computes `to_tsvector(<config>, text)` / `websearch_to_tsquery(<config>, …)`
   at query time. `config` is inlined (a `regconfig` must name a config, not
   be a bound value) and re-asserted against the 29-name allow-list — same
   safety basis as B1 inlining `'english'`. `ts_rank_cd` / RRF / `RRF_K = 60`
   / `kb_scope` filtering all unchanged.
4. **`hybridSearch`** — `HybridSearchOptions.language`, resolved and passed to
   `searchKeyword`. **`runtime.ts`** passes
   `agent.languageConfig.defaultLanguage ?? supportedLanguages?.[0]`.

**Skipped deliberately:** folding the keyword + dense halves into one SQL
query. Both *could* be SQL now (B2 moved dense in), but the JS-side RRF fusion
stays more legible as two ranked-id lists merged in one place — the plan
gated this on "only if it doesn't obscure the fusion".

**Gate:** `npm test` 270/270, `typecheck`, `lint` (0 errors), `npm run eval`
15/15 (english path byte-identical — zero movement), `npm run seed`
(migration `002` verified on the dev DB: `fts` column + old index gone,
`idx_kb_chunks_fts_english` present).

## B5 — Row-level security as a tenancy backstop → **DONE**

**What shipped** (branch `b5-row-level-security`, stacked on B3):

1. **Migration `003-row-level-security.ts`** — `ENABLE` + `FORCE ROW LEVEL
   SECURITY` on all 34 `tenant_id` tables (discovered via `information_schema`,
   so it's self-maintaining) and one `tenant_isolation` policy per table:
   `USING` / `WITH CHECK` `nullif(current_setting('app.tenant_id', true), '')
   IS NULL OR tenant_id = current_setting('app.tenant_id', true)`. Idempotent
   (`DROP POLICY IF EXISTS` first).
2. **The superuser problem.** The app's login role `cx` is a **superuser**, and
   superusers bypass RLS even under `FORCE`. So the migration also creates a
   `cx_tenant` (`NOLOGIN NOSUPERUSER`) role with DML grants + matching
   `ALTER DEFAULT PRIVILEGES`. A scoped query's transaction does
   `SET LOCAL ROLE cx_tenant` **and** `set_config('app.tenant_id', …, true)` —
   both unwind at COMMIT, so the pooled client is clean afterward.
3. **`SqlDatabase.forTenant(tenantId)`** (`src/db/pg.ts`) — a handle onto the
   same pool whose `prepare` / `exec` / `tx` each run inside `#txScoped`
   (the role + GUC transaction above). The root handle leaves `#tenantId`
   undefined and keeps the exact prior fast path. One `pool.on("error")`
   listener guard so `forTenant` handles don't stack listeners.
4. **`TenantScopedRepository`** (`src/tenancy/repository.ts`) — constructor does
   `this.db = db.forTenant(tenant.tenantId)`. **Nothing else in ~35 repos
   changed** — they only ever use `this.db.prepare` / `.tx`.

**The exemption is staying `cx`.** Migrations, `npm run seed`,
`TenantRepository`, and `src/auth/platform-admin-lookup.ts` all run on the
root handle → never drop the role, never set the GUC → superuser, sees
everything. No second connection string, no `BYPASSRLS` grant. `tenants`
itself has no `tenant_id` so it carries no policy.

**Divergence from the plan:** it named `src/db/client.ts` and a
"pooled-connection checkout" hook; the checkout hook doesn't fit the
`SqlDatabase` abstraction (single-statement autocommit), so the role/GUC ride
a per-query transaction in `pg.ts` instead. `client.ts` was untouched. The
`BYPASSRLS` / carve-out choice landed as "root stays superuser".

**Cost:** each scoped read is now `BEGIN; SET LOCAL ROLE; set_config; SELECT;
COMMIT`. Fine for a Phase-1 single-instance deployment on local/CI Postgres.

**Gate:** `npm test` 271/271, `typecheck`, `lint` (0 errors), `npm run eval`
15/15 (zero movement), `npm run seed` (migration `003` verified on the dev DB:
`cx_tenant` is `rolsuper=f`, 34 tables `rowsecurity`, a non-matching
`app.tenant_id` under `cx_tenant` sees 0 rows).

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
