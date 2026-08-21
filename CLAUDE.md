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
5. **Amarelle Botanique is tenant data/config here, never platform code.**
   Its KB content, seed data, and tool handlers (return-eligibility rule
   chain included) were deliberately ported in as the platform's first
   real tenant — that's fine, and expected of a multi-tenant platform.
   What's not fine: letting anything Amarelle-specific leak into
   `src/gateway/`, `src/tenancy/`, `src/kb/`, `src/agents/runtime.ts`, or
   the tool registry mechanics. Tenant-specific logic lives only under
   `src/tools/amarelle/` and this tenant's DB rows — those layers must stay
   usable by a second tenant with zero code changes.
6. **Dates**: inject the clock via `src/core/clock.ts`'s `today()` —
   never `new Date()` in business/eligibility logic. Tests that depend on
   date windows (e.g. `tests/tools.test.ts`'s REACTION-window case) must
   pin `process.env.DEMO_DATE`, or they silently start failing months
   later exactly like amarelle-handoff's own ORD-100001 case did.
7. **No write tools exist yet.** `check_return_eligibility` resolving
   `ELIGIBLE` is a deliberate escalation trigger (`src/agents/runtime.ts`),
   not a bug — there is nothing downstream that can act on the verdict
   until a write tool with an approval policy exists. Don't "fix" this by
   having the agent claim it completed a return.
8. **The in-memory session store is a known, deliberate simplification**
   (`src/agents/sessions-store.ts`) — full gateway-shape turn history
   (tool_use/tool_result blocks) lives in-process, not the DB. Fine for a
   single-process Phase 1 deployment; revisit before any multi-instance
   deploy (NFR-3.1).

## Before committing

```
npm test         # tenancy, gateway swap/fallback, KB retrieval, tools, agent runtime
npm run typecheck
npm run lint
```
