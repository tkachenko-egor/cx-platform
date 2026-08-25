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
   pattern exists to close.
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
8. **The in-memory session store is a known, deliberate simplification**
   (`src/agents/sessions-store.ts`) — full gateway-shape turn history
   (tool_use/tool_result blocks) lives in-process, not the DB. Fine for a
   single-process Phase 1 deployment; revisit before any multi-instance
   deploy (NFR-3.1).

## Before committing

```
npm test         # tenancy, gateway swap/fallback, KB retrieval, tools, agent runtime, guardrails, router/handoff
npm run typecheck
npm run lint
npm run eval      # golden-dataset regression gate (routing/tool-selection/escalation/guardrail accuracy)
```

If a change touches `src/db/schema.sql` or `src/db/migrations/`, also run
`npm run seed` against the real `cx-platform.db` (not just `:memory:`
tests) — `schema.sql`'s `CREATE TABLE IF NOT EXISTS` is a no-op against a
pre-existing DB file, so a bug where `schema.sql` itself references a
migration-added column only surfaces there, not in any test.
