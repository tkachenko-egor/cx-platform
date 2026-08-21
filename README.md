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
- **Still to come:** write tools with an approval policy; the guardrail
  suite; router/multi-agent handoff; the eval harness + CI regression gate.

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
