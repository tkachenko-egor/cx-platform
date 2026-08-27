# CX Platform — repo rules

A model-agnostic, multi-tenant customer-experience platform. See
[README.md](README.md) for current scope (Phase 1: six-week cut — widget,
one agent, hybrid-retrieval KB, read-only tools, human desk in copilot
mode, cost tracking, tracing). Full requirements:
[`docs/00-requirements.md`](docs/00-requirements.md).

## Invariants — do not change these without being asked

1. **No provider SDK type crosses the gateway boundary.** Only
   `src/gateway/providers/*.ts` may import a vendor SDK
   (`@anthropic-ai/sdk` today). Enforced by `eslint.config.mjs`'s
   `no-restricted-imports` rule — if you need a new provider, add its
   adapter file there and nowhere else touches the SDK.
2. **Every repository except `TenantRepository` extends
   `TenantScopedRepository`** and takes a `TenantContext` in its
   constructor, not as a per-method argument. Don't add a repository method
   that accepts `tenantId` as a parameter instead of relying on
   `this.tenantId` — that reopens the "forgot to filter" bug class this
   pattern exists to close. **Postgres RLS is the enforced backstop** (B5,
   migration `003`): `this.db` inside a scoped repo is a
   `SqlDatabase.forTenant()` handle that runs every query in a transaction
   with `SET LOCAL ROLE cx_tenant` + `set_config('app.tenant_id', …)`, so the
   `FORCE`d `tenant_isolation` policy blocks cross-tenant reads/writes even
   if a `WHERE tenant_id = ?` is missing. Unscoped cross-tenant access (only
   `TenantRepository`, `src/auth/platform-admin-lookup.ts`, migrations, seed)
   goes through the **root** `SqlDatabase` handle, which stays superuser `cx`
   and is exempt — don't route tenant-scoped work that way. A new
   `tenant_id` table needs its own policy + a `cx_tenant` DML grant.
   **Repository methods are `async`** and run on
   Postgres via the `SqlDatabase` surface in `src/db/pg.ts` (Phase B1 — `pg`
   pool underneath; `?` placeholders are translated to `$n`, `jsonb` columns
   come back parsed, `timestamptz` comes back as ISO strings). Every call
   site `await`s; the constructor stays synchronous. Multi-statement
   transactions go through `db.tx(async (q) => …)` so they pin one pooled
   client. `SELECT … AS "camelCaseAlias"` **must be quoted** — unquoted
   Postgres identifiers fold to lowercase.

   **The schema is migrations-only — there is no `schema.sql`.** B1 squashed
   the SQLite schema + 30 migrations into
   `src/db/migrations/000-baseline.ts`; new changes append `001-*`, `002-*`,
   … each idempotent (`IF NOT EXISTS` / `information_schema` guards) and
   tracked in `schema_migrations`. Tests and local dev need a reachable
   Postgres — `docker compose up -d db`; `createDb(":memory:")` clones a
   disposable database from a migrated template (`src/testing/global-setup.ts`).
3. **Model bindings are aliases, resolved per-tenant through
   `model_aliases`, never hardcoded to a provider/model string** in agent
   or gateway code. Changing what a tenant's agent runs on is a DB row
   edit, not a deploy — see `tests/gateway-swap.test.ts` for the executable
   version of that promise.
4. **Agent definitions are DB records, not code.** Don't add a
   TypeScript-defined agent config; extend `agent_defs` / `AgentDefRepository`.
5. **The built-in commerce tools (`src/tools/commerce/`) are generic,
   tenant-agnostic reference tools.** Order lookup, product search, return
   eligibility and order cancellation ship with the platform and must work
   for any tenant's catalogue unchanged — no vertical taxonomy in a zod/JSON
   schema, no currency or policy constant baked into a handler. Any
   tenant- or agent-specific behaviour is expressed through
   `agent_defs.tool_settings` (per-tool config, keyed by tool key) or
   `tool_defs.handler_config` (HTTP tools), never hardcoded into
   `src/tools/commerce/`, `src/gateway/`, `src/tenancy/`, `src/kb/`,
   `src/agents/runtime.ts`, or the tool registry mechanics. Tenant content
   lives in DB rows, `knowledge/`, and `data/` — those layers must stay
   usable by a second tenant with zero code changes.
6. **Dates**: inject the clock via `src/core/clock.ts`'s `today()` —
   never `new Date()` in business/eligibility logic. Tests that depend on
   date windows (e.g. `tests/tools.test.ts`'s extended-return-window case,
   and `scripts/eval/run-eval.ts`) must pin `process.env.DEMO_DATE`, or
   they silently start failing months later once the window lapses.
7. **Write tools require an approval policy, enforced in
   `src/tools/registry.ts`'s `executeTool`, never bypassed.** A write-flagged
   tool's `tool_defs.approval_policy` (`auto` / `confirm_with_customer` /
   `require_human_approval`) is checked before it ever mutates anything, and
   every write executes behind a conversation+arguments idempotency key
   (`tool_calls.idempotency_key`) so a retry can't double-execute. Don't add
   a write tool that runs without going through this gate. `cancel_order`
   is the first one — see `src/tools/commerce/cancel-order.ts`.
   `check_return_eligibility` resolving `ELIGIBLE` still escalates
   (`escalate: {reason}` on the tool result, a generic convention any tool
   can use) rather than claiming a return was completed — no
   `create_return` tool exists yet.
8. **The model-continuity session store is in the DB** (`agent_sessions`, via
   `src/agents/sessions-store.ts` → `AgentSessionRepository`, B6). Full
   gateway-shape replay history (tool_use/tool_result blocks) + the
   per-conversation counters, tenant-scoped. `getOrCreateSession(db, tenant,
   conversationId)` loads a plain object; the caller mutates it and calls the
   matching `saveSession*` helper — the channel turn persists
   `history`/`turnCount`, the agent runtime persists the tool-failure counter,
   as independent column upserts so they don't clobber. Retention:
   `npm run prune-sessions` (default 30d). The customer/desk transcript is
   still a separate concern (`MessageRepository`).

## Before committing

Postgres must be up: `docker compose up -d db`.

```
npm test         # tenancy, gateway swap/fallback, KB retrieval, tools, agent runtime, guardrails, router/handoff
npm run typecheck
npm run lint
npm run eval      # golden-dataset regression gate (routing/tool-selection/escalation/guardrail accuracy)
```

If a change touches `src/db/migrations/`, also run `npm run seed` against the
real dev database (`docker compose up -d db`) — the migration path against a
fresh Postgres is not the same as a test's template clone, and a broken
`ALTER`/backfill in a new migration only surfaces there.
