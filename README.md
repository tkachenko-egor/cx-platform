# CX Platform — Phase 0

A model-agnostic, multi-tenant foundation for a customer-experience
platform, built per [`docs/00-requirements.md`](docs/00-requirements.md).
This repo is deliberately separate from the
[amarelle-handoff](../amarelle-handoff) demo bot: that repo is a fictional
brand's fixed-business-rules chatbot with its own settled invariants; this
one is general-purpose platform infrastructure. Working pieces (KB
retrieval, the tool-calling loop, prompt assembly) will be lifted over
deliberately as later phases need them — nothing here inherits
amarelle-handoff's rules or constraints.

## What "Phase 0" means

Per the requirements doc's phased roadmap, Phase 0 is "refactor the
foundation... no new features." Its exit criterion:

> You can swap the underlying model by editing one config row, and nothing
> else in the codebase changes.

That's a real, executable test here: [`tests/gateway-swap.test.ts`](tests/gateway-swap.test.ts).

## What's in this slice

- **Canonical types** (`src/core/types.ts`) — `CanonicalMessage`,
  `Conversation`, `ConversationEvent`. Channel- and model-agnostic (FR-4.1).
- **Model gateway** (`src/gateway/`) — canonical `ChatRequest`/`ChatResponse`
  (FR-5.1), a capability matrix (FR-5.3), two provider adapters (Anthropic +
  a zero-network stub, FR-5.2), alias-based model binding with fallback
  chains (FR-5.6/5.7), and a normalised error taxonomy (FR-5.8). No provider
  SDK type crosses the gateway boundary — enforced by `eslint.config.mjs`,
  not just convention.
- **Tenancy** (`src/tenancy/`) — every repository is a
  `TenantScopedRepository` subclass that cannot be constructed without a
  `TenantContext` (FR-1.1's design note, made structural rather than a rule
  to remember).
- **Agent defs as data** (`src/db/repositories/agent-def-repository.ts`) —
  versioned, published records, not code (FR-6.1/6.3).
- **Basic tracing + usage accounting** (`src/tracing/trace.ts`,
  `llm_calls` table) — one row/line per provider call attempt, including
  failed attempts before a fallback (FR-5.10, a slice of FR-13.1).

## What's deliberately NOT here yet

Everything else in the requirements doc: orchestrator/router, multi-agent
handoff, channels (widget/email), human desk, KB/retrieval, tools registry,
control plane UI, analytics, evals, guardrails. Those are Phase 1 (see the
doc's "six-week cut" for the actual next slice) — building them on a shaky
foundation is the mistake Phase 0 exists to prevent.

## Running it

```bash
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY if you want the real provider to work
npm test               # tenancy isolation + capability matrix + the swap exit criterion
npm run typecheck
npm run lint
npm run seed            # creates a demo tenant, a model alias, and a published agent def
```

Local dev and the full test suite run with zero cloud dependencies: the
stub provider and an in-memory/local SQLite DB satisfy NFR-9.5.
