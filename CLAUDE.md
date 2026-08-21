# CX Platform — repo rules

A model-agnostic, multi-tenant customer-experience platform. See
[README.md](README.md) for current scope (Phase 0: foundation only, no
channels/agents/UI yet). Full requirements are the CX platform requirements
spec this repo was scaffolded from — ask the user if you need the source
file, it isn't checked in here.

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
5. **Business/product logic does not belong in this repo.** This is
   platform infrastructure — the fictional Amarelle Botanique brand rules
   live entirely in the separate `amarelle-handoff` repo and must not be
   imported or duplicated here.
6. **Dates**: inject the clock where one is needed: never `new Date()`
   scattered through business logic once that logic exists. (No business
   logic exists yet in Phase 0 beyond timestamps on writes.)

## Before committing

```
npm test         # tenancy isolation, capability matrix, gateway swap/fallback
npm run typecheck
npm run lint
```
