# CX Platform — Phase 1 (six-week cut)

A model-agnostic, multi-tenant customer-experience platform, built per
[`docs/00-requirements.md`](docs/00-requirements.md). This repo is
deliberately separate from the [amarelle-handoff](../amarelle-handoff) demo
bot: that repo is a fictional brand's fixed-business-rules chatbot with its
own settled invariants; this one is general-purpose platform
infrastructure. Amarelle Botanique's KB, seed data and tool logic were
ported in as this platform's **first tenant's data/config** — see
`CLAUDE.md` invariant #5 for the line between "tenant data" and "platform
code."

## What "Phase 1 (six-week cut)" means

Phase 0 built the foundation (model gateway, tenancy, agent-def records —
no channel, no KB, no tools, no UI). This slice is the doc's own trimmed
Phase 1: **widget only** (no email), **one agent** (no router), **KB with
hybrid retrieval**, **read-only tools**, **human takeover in copilot
mode**, **cost tracking**, **tracing**. Full scope notes, what's
deliberately deferred, and the reasoning behind each cut live in the plan
this was built from — ask if you need the original doc.

## What's in this slice

- **Streaming model gateway** (`src/gateway/`) — Phase 0's `chat()` plus a
  `chatStream()` for token-by-token delivery (NFR-1.1), a real per-model
  cost estimate, and an embedding-provider abstraction (`src/gateway/embeddings/`,
  OpenAI + a zero-network stub) separate from the chat abstraction (FR-5.12).
- **Hybrid-retrieval KB** (`src/kb/`) — structure-aware chunking, dense
  (cosine) + keyword (SQLite FTS5, porter-stemmed) retrieval fused with
  Reciprocal Rank Fusion, `kb_scope` audience filtering (FR-7.4/7.6/7.7),
  citations resolved back to the customer as chips.
- **Tool registry** (`src/tools/`) — JSON-Schema-backed `tool_defs` +
  code-side handlers, `{ok:false}` on error rather than a throw (FR-8.9),
  every call logged to `tool_calls` (FR-8.10). Amarelle's three read-only
  tools (`lookup_order`, `search_products`, `check_return_eligibility`)
  live under `src/tools/amarelle/`.
- **Agent runtime** (`src/agents/`) — the tool-calling loop, a templated
  system prompt (FR-6.2), and deterministic escalation triggers (FR-6.12):
  a severe-symptom keyword scan, an explicit human request, an eligible
  return with no write tool to complete it, or a loop-cap hit.
- **Web widget** (`components/chat/`, `app/api/chat/route.ts`) — SSE
  streaming, cards, citation chips, AI disclosure in the header (NFR-6.2),
  and a `handoff` event + polling fallback so a human's reply reaches the
  customer once escalated.
- **Human desk in copilot mode** (`app/desk/`, `app/api/desk/`) — list of
  conversations needing attention, a bot-drafted suggested reply the human
  edits and sends (FR-9.6), hand-back-to-bot, and a per-turn trace panel
  (model/tokens/cost/latency/tool calls — FR-13.2, folded into the desk
  rather than a separate module).
- **Cost tracking** (`src/analytics/cost.ts`) — real `cost_usd` per call,
  summed per conversation on the desk list (FR-11.6).

## Phase 1b — filling the deferred-but-actually-Phase-1 gaps

The six-week cut above deliberately skipped several things the requirements
doc classifies as Phase 1, not Phase 2. Phase 1b is filling those in,
milestone by milestone (see the plan this was built from for the full
sequence):

- **M1 — done.** Schema migration infra (`src/db/migrate.ts`,
  `src/db/migrations/`) and staff RBAC/auth (`src/auth/`,
  `users`/`sessions`/`audit_log` tables) — `/desk` and `/api/desk/*` now
  require an authenticated staff session.
- **M2 — done.** Email/ticketing channel (`src/channel/`) — the chat route's
  turn-handling logic was extracted into channel-agnostic
  `processInboundTurn` (`src/channel/turn.ts`), and a second channel
  (`src/channel/email/`: threading, quoted-reply stripping, autoresponder
  guard, ticket lifecycle) was built on top of it with zero changes to the
  agent runtime or orchestrator — proving NFR-9.2's "one interface" promise.
  Webhook receiver: `app/api/channels/email/inbound/route.ts`.
- **M3 — done.** Write tools with an approval policy + idempotency
  (`src/tools/registry.ts`'s `executeTool` now actually enforces
  `tool_defs.write_flag`/`approval_policy`, which existed in the schema
  since Phase 0 but were unenforced). First real write tool: `cancel_order`
  (`src/tools/amarelle/cancel-order.ts`). `auto`/`confirm_with_customer`/
  `require_human_approval` all gate on a conversation+arguments idempotency
  key (`tool_calls.idempotency_key`, `tool_approvals` table) so a retry
  never double-executes. Staff approve/deny parked calls at
  `app/api/desk/[conversationId]/approvals/[approvalId]/route.ts`, surfaced
  in the desk UI's new "Pending approvals" panel.
- **M4 — done.** Guardrail suite (`src/guardrails/`): deterministic
  prompt-injection screening on both the user's message and every retrieved
  KB chunk (FR-7.13 — a poisoned article is a real attack), run before the
  model is ever called; output-side groundedness (every `[doc_id]` citation
  must resolve to a doc retrieved this turn), a PII-leakage heuristic
  (flags anything in the reply not sourced from this turn's tool results),
  and a forbidden-claims marker list. Non-blocking by default — stream
  live, flag and escalate after the fact — with an opt-in `blockingMode`
  per agent (`agent_defs.guardrails`, previously unused) that buffers the
  full reply and swaps in a fallback instead of ever forwarding a blocked
  one.
- **M5/M6 — done.** Router + specialist agents + handoff protocol.
  `src/agents/router.ts`'s `runRouterTurn` is still an `agent_defs` row
  (FR-6.1) but issues one non-streaming call offering a single forced-shape
  tool, `route_to_agent`, whose enum is the router's own `handoffTargets`
  column (FR-6.6 — constrained enum, never free text; no new gateway
  capability needed). `src/agents/handoff.ts`'s `HandoffPackage`
  (reason/summary/extracted entities/instructions, FR-6.7) is what one
  agent hands another — never the raw transcript — persisted as a
  `messages` row (`role='handoff'`) and mirrored `events` row.
  `src/agents/loop-prevention.ts` forbids A→B→C→B-style cycles
  (FR-6.8) against `conversations.metadata.agentPath`, and a small
  per-request hop cap catches anything else, both escalating to a human
  rather than looping the customer's message. `src/channel/turn.ts` routes
  once on a conversation's first turn (tenants without a published
  `router` agent keep the original single-agent behavior, unchanged) and
  re-invokes the loop when a specialist requests a mid-turn handoff. Fixed
  a real bug this forced: the desk's copilot-draft endpoint had hardcoded
  `support-generalist` regardless of which agent a conversation was
  actually pinned to — harmless with one agent, wrong the moment a second
  one exists. The desk conversation page now shows an agent-path breadcrumb
  and the FR-9.3 handoff context package.
- **M7 — done.** Eval harness + golden dataset + CI regression gate
  (FR-12.1/12.2/12.4). `tests/eval/golden-conversations.json` is a
  versioned, hand-authored set of scripted conversations — each turn
  states what the model would say and what the system must then do
  (route/tool-call/escalate/guardrail-block/never mention a forbidden
  phrase). `scripts/eval/run-eval.ts` (`npm run eval`) drives every case
  through the real `processInboundTurn` pipeline with a scripted provider
  — no API key, no network — and `scripts/eval/scoring.ts`'s pure functions
  (unit-tested in `tests/eval-runner.test.ts`) score per-tag accuracy
  against `scripts/eval/thresholds.json`, failing the build on a miss.
  `src/testing/seed-fixtures.ts` factors the tenant/business-data/
  model-alias/tool-def/KB/agent-def bootstrap shared by `scripts/seed.ts`
  and the eval harness into one place. `.github/workflows/ci.yml` is the
  repo's first CI config: typecheck → lint → test → eval, all blocking.
  Verified the gate actually gates: a deliberately broken router
  `handoffTargets` array made the routing-accuracy metric fail exactly as
  expected, then was reverted.
- **Phase 1b is now complete** — all six items from §6 of the requirements
  doc that the original six-week cut deferred are built: schema migrations
  + staff RBAC, the email/ticketing channel, write tools with an approval
  policy, the guardrail suite, router/handoff, and this eval + CI gate.
  What's still deferred is the doc's actual §6 **Phase 2** list (sentiment
  escalation, SLA engine, macros, agent-performance analytics, A/B testing,
  semantic caching, coverage-gap reporting, human review queue) and Phase 3
  (messaging channels, voice, self-serve onboarding, visual flow builder).

None of these are accidental gaps — see the "consequence worth flagging"
note in `CLAUDE.md` invariant #7 for what an `ELIGIBLE` return verdict does
without a write tool behind it.

## Running it

```bash
npm install
cp .env.example .env    # ANTHROPIC_API_KEY + OPENAI_API_KEY for the real experience
npm run seed             # tenant, business data, tool defs, KB ingest, published agent
npm test
npm run typecheck
npm run lint
npm run dev               # demo widget at /, human desk at /desk
```

Without API keys, the app still runs end-to-end: the model gateway falls
back to its zero-network stub provider, and KB retrieval falls back to
stub (non-semantic) embeddings — structurally complete, just not
meaningfully "smart," per NFR-9.5's zero-cloud-dependency local dev.
