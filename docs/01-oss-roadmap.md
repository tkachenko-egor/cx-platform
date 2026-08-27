# OSS adoption roadmap

Thirteen tasks adopting open-source components into cx-platform, plus the
SQLite → Postgres migration they depend on. Every component listed is
MIT / Apache-2.0 / BSD / PostgreSQL-licensed and free for commercial use in
a hosted multi-tenant product. Licence review and the rejected options are
at the bottom.

## How to work this doc

- One task per session. Task IDs (`A1`, `B2`, …) are stable — reference them
  in commits and PR titles.
- Each task states the files it should touch. Straying outside them means
  the task was mis-scoped: stop and say so rather than widening it.
- Every task's Definition of Done includes the gates from `CLAUDE.md`:

  ```
  npm test && npm run typecheck && npm run lint && npm run eval
  ```

  Plus `npm run seed` against the real `cx-platform.db` for anything touching
  `src/db/schema.sql` or `src/db/migrations/`.
- No task may break an invariant in `CLAUDE.md`. Where a task moves close to
  one, it says which and why it holds.

## Sequencing

Phase A is independent of the database and can start immediately. Phase B is
the Postgres migration and is strictly ordered internally. **A1 should land
before B2/B3** — it is small, high value, and B2/B3 must then preserve the
rerank stage they rewrite around. A6, A7 and B6 can be dropped or deferred
without affecting anything else.

---

# Phase A — retrieval and guardrail quality

No database dependency. Any of these can ship on the current SQLite build.

## A1 — Cross-encoder rerank after RRF

**Component:** `bge-reranker-v2-m3` (MIT). CPU-only alternative: FlashRank
(Apache-2.0).

**Why:** `hybridSearch()` fuses dense and keyword results with RRF and
returns the top `limit` directly. Reciprocal rank fusion is a cheap
approximation of relevance; a cross-encoder that sees query and chunk
together is the largest single quality gain available to this retriever. It
also makes the groundedness guardrail's job easier by putting the correct
chunk first.

**Files:** `src/kb/retrieval.ts`, `tests/kb.test.ts`. A reranker provider
abstraction alongside `src/gateway/embeddings/` (same shape: an interface, a
real implementation, a deterministic stub for tests).

**Approach:**
- Over-fetch inside `hybridSearch()` — take ~50 candidates from fusion
  instead of `limit`.
- Rerank the candidate set, then truncate to `limit`.
- Keep the `hybridSearch()` signature unchanged so no caller moves.
- Reranking must be optional and configured per agent, defaulting off, so an
  unavailable reranker degrades to today's behaviour rather than failing a
  turn. Follow the `agent_defs` config pattern — no hardcoded constants.

**Acceptance:**
- A test proves the rerank stage reorders a candidate set where RRF alone
  puts the right chunk second.
- A test proves a failing/absent reranker returns the un-reranked RRF order
  rather than throwing.
- `kb_retrieval_log` records that reranking ran, so the effect is measurable
  in production.

## A2 — Typed PII detection in the output guardrail

**Component:** Microsoft Presidio (MIT), run as a sidecar service.

**Why:** `checkPiiLeakage()` in `src/guardrails/output.ts` matches two
regexes — `EMAIL_PATTERN` and `PHONE_PATTERN`. It cannot see payment cards,
IBANs, national ID numbers, postal addresses or person names, and it has no
per-locale behaviour. This is the guardrail an enterprise tenant asks about
by name in a security review.

**Files:** `src/guardrails/output.ts`, `src/guardrails/types.ts`,
`tests/guardrails.test.ts`.

**Approach:**
- Presidio runs as its own HTTP service; call it from the guardrail. Nothing
  Python enters the Node process.
- Preserve the existing `"block" | "redact"` mode contract —
  Presidio's anonymizer covers the redact path natively, so
  `AgentGuardrailConfig.output.piiMode` does not change shape.
- Keep the current regexes as the offline fallback: if the service is
  unreachable the guardrail must still run, not fail open silently.
- Entity types allowed/denied per agent belong in `agent_defs.guardrails`,
  not in code.

**Acceptance:**
- Card number, IBAN and person name in an unattributed reply are all caught.
- A reply whose PII *is* present in this turn's tool results still passes —
  the attribution logic is unchanged.
- Service down → falls back to regex checks, logs the degradation, does not
  throw.

## A3 — Retrieval metrics in the eval gate

**Component:** Ragas (Apache-2.0).

**Why:** `npm run eval` scores routing, tool selection, escalation and
guardrail accuracy. It cannot fail on retrieval quality. A change to
chunking, embeddings or fusion that returns worse chunks passes CI today.

**Files:** `scripts/eval/scoring.ts`, `scripts/eval/thresholds.json`,
`scripts/eval/run-eval.ts`, `tests/eval-runner.test.ts`, and retrieval
expectations added to `tests/eval/golden-conversations.json`.

**Approach:**
- Add context precision, context recall and faithfulness as metrics in
  `summarize()`, alongside the existing rates.
- New threshold keys in `thresholds.json`; `checkThresholds()` fails the gate
  on a miss exactly as it does for the existing metrics.
- Golden cases need expected-chunk annotations for the turns that retrieve.
- Metric computation that needs a model must run through the gateway with a
  pinned alias, and must be skippable offline so `npm test` stays
  network-free (NFR-9.5).

**Acceptance:**
- Deliberately degrading retrieval (e.g. `limit = 1`, or disabling the
  keyword half) fails `npm run eval`.
- The eval still runs with no network configured, skipping model-dependent
  metrics with a clear message rather than erroring.

## A4 — Wider prompt-injection coverage

**Component:** LLM Guard (MIT) — pattern source, not a runtime dependency.

**Why:** `INJECTION_MARKERS` in `src/guardrails/input.ts` is a hand-written
list of substrings. FR-7.13 treats a poisoned KB article as a real attack,
which makes the breadth of this list a security property.

**Files:** `src/guardrails/input.ts`, `tests/guardrails.test.ts`.

**Approach:**
- Mine LLM Guard's prompt-injection and jailbreak scanner patterns; port
  them as data, keeping the check deterministic and pre-model as M4 requires.
- Preserve MIT attribution for any patterns copied verbatim.
- Keep the marker list as data separate from the scan function so it can be
  reviewed as a list.
- Consider case/spacing normalisation before matching — the current exact
  substring scan is trivially evaded by inserted whitespace.

**Acceptance:**
- A corpus of known injection strings is caught; a corpus of benign customer
  messages containing words like "ignore" produces no false positives.
- The scan still runs before any model call, on both user message and every
  retrieved chunk.

## A5 — Layout-aware document ingestion

**Component:** Docling (MIT). Wider-format alternative: Unstructured
(Apache-2.0, library only — the hosted API is a paid product).

**Why:** `src/kb/chunking.ts` is structure-aware, but `src/kb/pdf-extract.ts`
uses `pdf-parse`, which flattens headings, tables and reading order before
the chunker ever sees them. The chunker is doing its best on destroyed
input.

**Files:** `src/kb/pdf-extract.ts`, `src/kb/chunking.ts`,
`scripts/ingest-kb.ts`, `tests/kb.test.ts`.

**Approach:**
- Replace the extractor, keeping the interface `chunking.ts` consumes;
  extend it with heading level and table structure where Docling provides
  them.
- Re-ingestion of existing tenant KBs is a data migration — document it, do
  not silently change retrieval for existing tenants without a reindex.
- Keep a fixture PDF in `tests/fixtures/` so extraction quality is asserted,
  not assumed.

**Acceptance:**
- A fixture PDF with headings and a table produces chunks that preserve both.
- Chunk counts and citation resolution for the existing fixtures stay stable
  or improve; `npm run eval` does not regress.

## A6 — Portable trace export

**Component:** OpenTelemetry / OpenLLMetry (Apache-2.0).

**Why:** `emitTrace()` in `src/tracing/trace.ts` is a single function, which
makes an exporter behind it a contained change. Enterprise tenants expect to
point spans at their own observability stack; today tracing only surfaces in
the desk panel.

**Files:** `src/tracing/trace.ts` plus a new exporter module. No call sites
change.

**Approach:**
- Emit GenAI semantic-convention spans (model, tokens, cost, latency, tool
  calls) in addition to the existing in-app trace events, never instead of
  them.
- Export is opt-in by environment configuration; absent config, behaviour is
  unchanged and no network calls happen.
- Tenant ID belongs on spans as an attribute — check what else on a span
  could be tenant-sensitive before exporting it.

**Acceptance:**
- With no exporter configured, `npm test` behaviour and desk trace panel
  output are byte-identical to before.
- With a collector configured, a chat turn produces a span tree covering the
  model call and each tool call.

## A7 — Eval reporting and baseline diff *(optional)*

**Component:** promptfoo (MIT).

**Why:** `run-eval.ts` prints a summary. Comparing two runs, or sharing a
result with someone who did not run it, is manual.

**Files:** `scripts/eval/` only. No pipeline changes.

**Approach:** Wrap the existing runner's output; do not replace
`processInboundTurn` as the thing under test. If this task starts changing
how cases execute, stop — the value here is reporting only.

**Acceptance:** A run produces a shareable report and a diff against a stored
baseline. The CI gate still comes from `checkThresholds()`.

---

# Phase B — SQLite → Postgres

Strictly ordered. B0 and B1 are the risky ones and are deliberately split so
the async refactor and the engine swap are never in flight at the same time.

Measured scope at the time of writing: 221 `.prepare(` sites, 88 files
importing `better-sqlite3`, 5 SQLite-only SQL constructs outside the FTS
table, 40+ test suites relying on the `:memory:` path.

## B0 — Make the data layer async, still on SQLite

**Why:** `better-sqlite3` is synchronous; every Postgres driver is not. That
async conversion is the bulk of the migration and it is mechanical. Doing it
while the engine is unchanged means it can land, be reviewed and stay green
on its own, instead of being tangled with dialect and connection changes.

**Files:** `src/tenancy/repository.ts`, all of `src/db/repositories/`, and
every caller up the chain — `src/tools/registry.ts`, `src/agents/runtime.ts`,
`src/channel/turn.ts`, `app/api/**`, `scripts/eval/run-eval.ts`, tests.

**Approach:**
- Make every repository method `async` and every call site `await`, keeping
  `better-sqlite3` underneath. Behaviour must not change.
- Do it repository by repository, keeping the suite green at each step.
- Invariant #2 holds throughout: `TenantContext` stays a constructor
  argument; no method gains a `tenantId` parameter.

**Acceptance:** No `Database.Database` type appears outside `src/db/`. Full
gate passes. No behaviour change is observable in the eval.

## B1 — Swap the engine

**Component:** `pg` (MIT) or `postgres.js` (Unlicense). Optionally Kysely
(MIT) for type-checked SQL without adopting an ORM.

**Files:** `src/db/client.ts`, `src/db/migrate.ts`, `src/db/schema.sql`,
`src/db/migrations/`, `src/tenancy/repository.ts`.

**Approach:**
- Connection pool replaces the single `Database` handle.
- Dialect fixes: `json_extract` / `json_each` → `->>` and
  `jsonb_array_elements`; `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`.
  Only five such sites exist outside FTS.
- Take the type upgrade while rewriting the schema: real `boolean`,
  `timestamptz`, `jsonb` instead of TEXT-encoded equivalents.
- **Decide the bootstrap question explicitly.** `CLAUDE.md`'s note about
  `CREATE TABLE IF NOT EXISTS` being a no-op against an existing file is a
  SQLite-shaped rule. Either keep `schema.sql` + migrations as a pair with a
  documented rule for which owns what, or squash to a baseline migration and
  delete `schema.sql`. Running both against one database is how they drift.
  Update `CLAUDE.md` with whichever is chosen.
- Transactions must pin one pooled client for their whole life — the
  synchronous code never had to think about this and it is the most likely
  source of subtle bugs in this task.
- `src/core/clock.ts` still owns time. Do not reach for `now()` in SQL for
  business or eligibility logic (invariant #6).

**Acceptance:** Full gate passes against Postgres. `npm run seed` produces a
working database from scratch. `tests/gateway-swap.test.ts` and the tenancy
suite are unchanged in intent.

## B2 — pgvector for dense retrieval → **done**

**Component:** pgvector (PostgreSQL licence).

Shipped: `kb_chunks.embedding` is a pgvector `vector`; `hybridSearch`'s dense
half ranks in SQL (`embedding <=> $1`). Column left unsized with exact KNN and
no HNSW index — the embedding dimension is provider-dependent, so an ANN index
is a follow-up once a deployment locks its model. See
`02-oss-adoption-implementation-plan.md` for the detail.

**Files:** `src/kb/retrieval.ts`, `src/kb/ingest.ts`, schema/migration.

**Approach:** `CREATE EXTENSION vector`; embedding column plus an HNSW index.
`cosineSimilarity()` and the full scan behind it are retired — the ordering
moves into SQL. If A1 has landed, the reranker stage stays exactly where it
is, now fed by an indexed candidate set.

**Acceptance:** KB tests pass against pgvector; retrieval results for the
fixture corpus match the pre-migration ordering (modulo ANN recall);
`npm run eval` does not regress.

## B3 — Postgres full-text search → **done**

Shipped: B1 did the `tsvector` + GIN + `websearch_to_tsquery` / `ts_rank_cd`
base port. B3 made the language per-agent — `searchKeyword` takes a Postgres
text-search config resolved from `agent_defs.language_config`
(`src/kb/text-search-config.ts`); migration `002` replaced the hardcoded
`'english'` generated column with a query-time `to_tsvector(<config>, text)`
plus an `'english'` expression index. Keyword+dense stayed two queries fused
in JS (kept the fusion legible). See
`02-oss-adoption-implementation-plan.md` for the detail.

**Files:** `src/kb/retrieval.ts`, schema/migration.

**Approach:** `kb_chunks_fts` (fts5, `porter unicode61`) becomes a `tsvector`
column with a GIN index. `toFtsQuery()` gives way to `websearch_to_tsquery`,
ranked with `ts_rank_cd`, feeding the same RRF fusion with the same `RRF_K`.
The `english` configuration covers today's porter stemming; per-language
configurations are now available and should be wired to the agent language
field added in migration 022 rather than hardcoded.

**Acceptance:** Keyword-half results for the fixture corpus are equivalent or
better. `kb_scope` audience filtering (FR-7.4/7.6/7.7) is preserved. Dense
and keyword halves can now be one query — take that only if it does not
obscure the fusion logic.

## B4 — Keep tests dependency-free → **folded into B1, PGlite dropped**

The decision (B1) was a **real Postgres in the test loop**, not PGlite:
`docker compose up -d db` locally, a `services:` container in CI. NFR-9.5's
"zero *cloud* dependency" holds — the DB is a local disposable container, no
API key, no network. `createDb(":memory:")` clones a throwaway database from
a migrated template built once per run. There is no separate B4 task.

## B5 — Row-level security as a tenancy backstop

**Why:** invariant #2 exists to close the "forgot to filter" bug class by
convention. Postgres can make it an enforced constraint.

**Files:** schema/migration, `src/db/client.ts`, `src/tenancy/repository.ts`.

**Approach:** RLS policies on every tenant-scoped table, with
`SET LOCAL app.tenant_id` issued per connection checkout from the tenant
context. The platform-owner path (migration 029) needs a deliberate,
documented exemption rather than an accidental bypass.

**Acceptance:** A test proves a repository with tenant A's context cannot
read tenant B's rows even when the WHERE clause is removed. The
platform-admin path still works and is covered by its own test.

## B6 — Durable session store

**Why:** invariant #8 names the in-memory store in
`src/agents/sessions-store.ts` as a deliberate simplification blocking
multi-instance deploys (NFR-3.1). Postgres is what unblocks it.

**Files:** `src/agents/sessions-store.ts`, schema/migration.

**Approach:** Full gateway-shape turn history (tool_use / tool_result blocks)
into `jsonb`, tenant-scoped like everything else. Keep the existing interface
so `src/agents/runtime.ts` does not change. Needs a retention/cleanup story —
this table grows without bound otherwise.

**Acceptance:** Two processes against one database can serve alternating
turns of the same conversation. Invariant #8 is removed from `CLAUDE.md`.

---

# Licences

All adopted components are free for commercial use in a hosted multi-tenant
product, with no per-seat or per-message fee:

| Component | Licence |
| --- | --- |
| bge-reranker-v2-m3, Presidio, LLM Guard, Docling, promptfoo, pg, Kysely | MIT |
| Ragas, OpenTelemetry, OpenLLMetry, FlashRank, Unstructured (library) | Apache-2.0 |
| pgvector | PostgreSQL licence |

## Rejected — do not re-open without a reason

- **sqlite-vec** — obsolete once Phase B lands.
- **PGlite / postgres.js** — B1 chose `pg` against a real disposable
  Postgres (Docker / CI service container) for the test loop rather than an
  in-process WASM engine or a second driver. Re-opening PGlite means
  re-accepting a second engine's dialect quirks in the test path.
- **Dify** — its modified Apache licence forbids operating a multi-tenant
  environment without written authorisation. Disqualifying.
- **n8n** — Sustainable Use Licence forbids offering it as a service.
- **ParadeDB / pg_search** — real BM25 in Postgres and a tempting upgrade
  over `ts_rank_cd`, but AGPL-3.0 loaded into the database server we host.
  Requires a deliberate legal decision, not a `CREATE EXTENSION`.
- **Typebot, Zammad, FreeScout** — AGPL-3.0 against a hosted product.
- **Elasticsearch** — AGPL / ELv2 / SSPL tri-licence. OpenSearch
  (Apache-2.0) is the substitute if FTS is ever outgrown.
- **Rasa** — Apache-2.0 but in maintenance mode since Jan 2025; Rasa Pro /
  CALM is commercially licensed. Intent-classifier architecture is a step
  back from a tool-calling runtime.
- **Botpress** — the MIT repo is SDK and integrations only; the platform is
  cloud-only proprietary, and self-hostable v12 is archived AGPL.
- **Chatwoot as a platform** — replacing the desk means adopting Rails,
  Postgres and Redis and giving up our tenancy model. Its inbox UX is worth
  reading as a spec.
- **Langfuse** — duplicates the per-turn trace panel and `cost_usd` tracking
  we already have. A6 buys the portable half for far less.
- **LiteLLM proxy, Vercel AI SDK** — `src/gateway/` already abstracts
  providers with a capability matrix and alias resolution. Revisit only if
  we need dozens of providers we will not write adapters for.
- **Qdrant** — pgvector covers us well past current KB size; a second
  datastore is a consistency problem we do not have.
- **Llama Guard, Jina rerankers** — non-permissive model licences (Llama
  community terms; some Jina weights are CC-BY-NC) where permissive
  equivalents exist.
- **LiveKit Agents, Pipecat** — real options for voice, wrong phase.

Licence states verified August 2026. Source-available licences change more
often than open ones; re-check before adding a dependency.
