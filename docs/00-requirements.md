# CX Platform — Requirements Specification

**Version:** 0.1 (draft)
**Date:** 21 August 2026
**Starting point:** existing Node.js chatbot with knowledge base, LLM connection, and tool calling

---

## 0. Scope & Assumptions

### 0.1 What we are building

A customer-experience platform for **your own product/business**, where:

- **Multiple AI agents** collaborate — a router dispatches to specialised agents (billing, technical, sales), and agents can hand off to each other.
- **AI and human agents share the same conversation** — the bot handles tier-1, escalates to a human inbox with full context, and a human can take over mid-conversation and hand back.
- **Multi-tenancy is built in from day one** — even though you start with one tenant, every entity carries a tenant boundary so you can add brands, business units, or (later) external customers without a migration.
- **Channels:** embeddable web chat widget and email/ticketing. Messaging apps and voice are explicitly out of scope for v1 but the channel layer must not preclude them.
- **Model-agnostic:** no provider SDK type ever escapes the gateway boundary.

### 0.2 Assumptions to confirm

| # | Assumption | Impact if wrong |
|---|---|---|
| A1 | Multi-tenancy is for your own brands/business units, not paying external customers | If external: adds billing, self-serve onboarding, per-tenant SLAs, stricter isolation |
| A2 | Data residency is EU (you're in Kiev / likely EU-facing customers) | Changes hosting, vector store, and model-provider choice |
| A3 | Peak concurrency in v1 is tens, not thousands, of simultaneous conversations | Changes queue/worker design and whether you need a dedicated streaming tier |
| A4 | You will run this yourself (single deployment) rather than shipping it as installable software | Config-as-code vs config-in-UI weighting |

### 0.3 What "done" means for v1

A customer lands on your site, opens the widget, gets a correct answer from the right specialist agent grounded in your KB, and — when the bot can't help — reaches a human who sees the whole transcript and picks up seamlessly. An admin can change agents, prompts, models and KB content without a deploy. You can see what every conversation cost and whether it was any good.

---

## 1. Architecture Overview

Nine layers, each replaceable independently. The discipline that keeps this from becoming a monolith is that **each layer only speaks the canonical internal types**, never a vendor's.

```
┌──────────────────────────────────────────────────────────────────┐
│  CHANNEL ADAPTERS      web widget · email/IMAP · (later: WA, voice)│
├──────────────────────────────────────────────────────────────────┤
│  CONVERSATION CORE     threads · messages · state machine · SLA   │
├──────────────────────────────────────────────────────────────────┤
│  ORCHESTRATOR          routing · handoff · loop & budget guards   │
├──────────────────────────────────────────────────────────────────┤
│  AGENT RUNTIME         agent defs · prompt assembly · tool loop   │
├──────────────────────────────────────────────────────────────────┤
│  CAPABILITY PROVIDERS  ┌ KB / retrieval  ┌ tools / actions        │
├──────────────────────────────────────────────────────────────────┤
│  MODEL GATEWAY         provider adapters · fallback · cost meter  │
├──────────────────────────────────────────────────────────────────┤
│  HUMAN DESK            inbox · presence · routing · takeover      │
├──────────────────────────────────────────────────────────────────┤
│  CONTROL PLANE         admin UI · config · versioning · RBAC      │
├──────────────────────────────────────────────────────────────────┤
│  OBSERVABILITY         traces · evals · analytics · audit log     │
└──────────────────────────────────────────────────────────────────┘
```

**The single most important structural rule:** the orchestrator, agent runtime and conversation core must be *channel-agnostic and model-agnostic*. If you can't run the same agent over the widget, over email, and in a test harness with no channel at all, the abstraction has leaked.

---

## 2. Functional Requirements

### FR-1 — Tenancy & Workspaces

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Every persisted entity carries a `tenant_id`; queries are tenant-scoped at the data-access layer, not at the call site | Must |
| FR-1.2 | Tenant-scoped configuration: agents, prompts, KB sources, tools, model bindings, branding, business hours | Must |
| FR-1.3 | Per-tenant secret storage for model provider keys (BYOK) with encryption at rest | Must |
| FR-1.4 | Per-tenant usage budget (monthly token/cost ceiling) with soft-warn and hard-stop thresholds | Must |
| FR-1.5 | Vector store isolation per tenant (separate namespace/collection, never a `WHERE tenant_id` filter alone) | Must |
| FR-1.6 | Tenant provisioning API/CLI so a new brand is a config action, not a deploy | Should |
| FR-1.7 | Cross-tenant analytics for the platform owner only | Could |

> **Design note.** The cheapest version of multi-tenancy that doesn't paint you into a corner: one database, `tenant_id` on every table, a repository layer that *cannot* build a query without a tenant context (enforce it in the type system or via a required constructor argument), and separate vector namespaces. Don't build database-per-tenant until someone pays you to.

### FR-2 — Identity, Auth & RBAC

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Staff authentication (email+password or OIDC/SSO) with session management | Must |
| FR-2.2 | Roles: `owner`, `admin`, `supervisor`, `agent`, `viewer` — with a documented permission matrix | Must |
| FR-2.3 | End-user identity: anonymous visitors (cookie/session token) *and* authenticated users (signed JWT handoff from your app) | Must |
| FR-2.4 | Widget authentication via HMAC-signed user payload so the bot can trust "this is customer #4471" | Must |
| FR-2.5 | Identity merging — anonymous session becomes a known customer after login, history carries over | Should |
| FR-2.6 | API keys for programmatic access, scoped per tenant with rotation | Should |
| FR-2.7 | Audit log of all privileged actions (config change, PII access, conversation export) | Must |

### FR-3 — Channel Layer

**Common contract.** Every channel adapter implements the same interface: `receive(rawEvent) → CanonicalInboundMessage`, `send(CanonicalOutboundMessage) → deliveryReceipt`, plus capability flags (streaming? attachments? rich cards? typing indicators? read receipts?).

#### Web chat widget

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Single-file embeddable script tag; renders in an iframe for CSS isolation | Must |
| FR-3.2 | Token-by-token streaming responses over SSE or WebSocket | Must |
| FR-3.3 | Persistent conversation across page navigation and browser sessions | Must |
| FR-3.4 | Typing indicators, read state, and a visible "you're talking to AI" disclosure (see NFR-6.2) | Must |
| FR-3.5 | File/image upload with type + size validation and virus scanning | Should |
| FR-3.6 | Configurable appearance per tenant: colours, logo, position, launcher text, greeting | Must |
| FR-3.7 | Proactive triggers — open on URL match, time on page, or exit intent | Could |
| FR-3.8 | Offline/out-of-hours mode that collects an email and creates a ticket | Must |
| FR-3.9 | Graceful degradation: if the backend is down, the widget offers an email fallback rather than showing a spinner forever | Must |
| FR-3.10 | Widget bundle under 50 KB gzipped, loaded async, zero layout shift | Should |

#### Email / ticketing

| ID | Requirement | Priority |
|---|---|---|
| FR-3.11 | Inbound email ingestion (IMAP poll or provider webhook — Postmark/SES/Mailgun) | Must |
| FR-3.12 | Thread reconstruction via `Message-ID` / `In-Reply-To` / `References` headers, with a subject-hash fallback | Must |
| FR-3.13 | Quoted-reply and signature stripping before the text reaches an agent | Must |
| FR-3.14 | Attachment extraction and storage, with text extraction for PDFs/docs so the KB and agents can read them | Should |
| FR-3.15 | Outbound send with correct threading headers, per-tenant from-address and DKIM/SPF alignment | Must |
| FR-3.16 | Bounce, complaint and auto-responder handling (never reply to a vacation autoresponder — this is how loops start) | Must |
| FR-3.17 | Ticket lifecycle: `new → open → pending_customer → pending_internal → resolved → closed`, with auto-close after N days pending | Must |
| FR-3.18 | Ticket properties: priority, category, tags, assignee, due-by | Must |
| FR-3.19 | SLA policies per tenant with first-response and resolution timers, pause on `pending_customer` | Should |
| FR-3.20 | Merge and split tickets; link related tickets | Could |

### FR-4 — Conversation Core

| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | Canonical message model — see §4 — used identically by every channel and agent | Must |
| FR-4.2 | Explicit conversation state machine: `bot_active`, `awaiting_human`, `human_active`, `snoozed`, `resolved`, `closed`. Transitions are logged events, not field mutations | Must |
| FR-4.3 | Full turn history with an append-only event log; messages are never edited in place | Must |
| FR-4.4 | Message types: `user`, `assistant`, `agent_human`, `system`, `tool_call`, `tool_result`, `handoff`, `note` (internal, never shown to customer) | Must |
| FR-4.5 | Idempotent inbound handling — a duplicate webhook must not create a duplicate turn | Must |
| FR-4.6 | Conversation-level metadata bag for channel data, customer attributes, and agent-set variables | Must |
| FR-4.7 | Concurrency control: two inbound messages arriving during one agent run must not produce interleaved replies (per-conversation lock or serialised queue) | Must |
| FR-4.8 | Context-window management strategy: rolling window + running summary + pinned facts, with the truncation point recorded in the trace | Must |
| FR-4.9 | Conversation search across transcripts (full-text, tenant-scoped) | Should |

> **Failure mode to design for explicitly.** The customer sends three rapid messages while the agent is mid-tool-call. Decide now: do you cancel and restart the run with the fuller context, or queue and answer sequentially? Cancel-and-restart feels better to users; make it a configurable debounce window (~1.5 s) rather than a hardcoded choice.

### FR-5 — Model Gateway (the model-agnostic layer)

This is the layer that most projects get wrong, and getting it right is cheap now and very expensive later.

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | A single internal `ChatRequest`/`ChatResponse` type. **No provider SDK type crosses this boundary in either direction** | Must |
| FR-5.2 | Provider adapters implementing that interface: OpenAI, Anthropic, Google, plus at least one OpenAI-compatible self-hosted endpoint (vLLM/Ollama) to prove the abstraction | Must |
| FR-5.3 | **Capability matrix per model**: tool calling, parallel tool calls, structured output/JSON schema, vision, streaming, extended reasoning, context length, max output. The runtime reads this and adapts — it never assumes | Must |
| FR-5.4 | Graceful degradation: if a bound model lacks native tool calling, the gateway falls back to a prompted-JSON tool protocol rather than failing | Should |
| FR-5.5 | **Model binding is per-node, not global.** Each agent, each router, each summariser, each guardrail, each embedding job names its own model reference | Must |
| FR-5.6 | Model references are **logical aliases** (`triage-fast`, `support-main`, `summarise-cheap`) resolved through a tenant-level mapping table. Swapping the underlying model is a config change | Must |
| FR-5.7 | Fallback chains per alias with configurable trigger conditions: rate limit, 5xx, timeout, content filter. Fallbacks are logged and surfaced in analytics | Must |
| FR-5.8 | Normalised error taxonomy across providers: `RateLimited`, `ContextTooLong`, `ContentFiltered`, `Timeout`, `InvalidRequest`, `ProviderUnavailable` | Must |
| FR-5.9 | Uniform streaming interface — the caller sees the same token/tool-call event stream regardless of provider wire format | Must |
| FR-5.10 | Normalised usage accounting: prompt tokens, completion tokens, cached tokens, reasoning tokens, cost in a single currency, per request, attributed to conversation + agent + tenant | Must |
| FR-5.11 | Prompt caching support where the provider offers it, with cache-hit rate visible in metrics | Should |
| FR-5.12 | Embedding provider abstraction, separate from the chat abstraction, with the model identity **stored alongside every vector** so you can detect mismatches after a model swap | Must |
| FR-5.13 | Request-level timeout, retry with jittered backoff, and a circuit breaker per provider | Must |
| FR-5.14 | Deterministic replay mode: a recorded request can be re-run against a different model for A/B comparison | Should |
| FR-5.15 | Optional PII redaction hook applied *before* the request leaves your infrastructure, configurable per tenant and per provider | Should |

> **Build vs buy.** You can either write these adapters yourself or put a gateway like [LiteLLM](https://qveris.ai/guides/litellm-alternative-comparison/) or [OpenRouter](https://techjacksolutions.com/ai-tools/llm-gateways/openrouter-vs-litellm/) in front. Even if you buy, keep FR-5.1's internal type — otherwise you've just swapped a dependency on OpenAI for a dependency on the gateway. The capability matrix (FR-5.3) is yours to own either way; no gateway will model it the way your runtime needs.

### FR-6 — Agent Runtime & Multi-Agent Orchestration

| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | **Agents are data, not code.** An agent definition is a versioned record: name, description, system prompt, model alias, tool allowlist, KB scope, handoff targets, guardrail config, temperature/params | Must |
| FR-6.2 | Prompt templating with typed variables (customer name, tenant, locale, current time, order context) and a strict "no undefined variable renders" rule | Must |
| FR-6.3 | Agent versioning with publish/rollback; a running conversation pins the version it started with | Must |
| FR-6.4 | Draft/staging vs published environments so you can test prompt changes against real traffic replays before shipping | Should |
| FR-6.5 | The tool-calling loop: call model → execute tools → feed results → repeat, with a hard max-iteration cap and per-turn cost ceiling | Must |
| FR-6.6 | **Router/supervisor agent** that classifies intent and dispatches to a specialist. Router output is a constrained enum, never free text | Must |
| FR-6.7 | **Handoff protocol** between agents: structured object carrying reason, summary of the conversation so far, extracted entities, and what the receiving agent should do. Not "just pass the whole transcript" | Must |
| FR-6.8 | Handoff loop prevention: track the agent path, forbid A→B→A cycles beyond a threshold, escalate to human on repeat | Must |
| FR-6.9 | Shared conversation state vs per-agent private scratchpad, with an explicit rule for what is promoted to shared | Must |
| FR-6.10 | Parallel sub-agent execution for read-only tasks (e.g. simultaneously check order status and shipping status), results merged before the reply | Should |
| FR-6.11 | Per-conversation and per-turn budget guards: max tokens, max cost, max tool calls, max wall-clock. Breach → deterministic fallback message + human escalation | Must |
| FR-6.12 | Deterministic escape hatches that bypass the LLM entirely — keyword triggers for "agent", "human", "cancel", legal/complaint keywords, and detected distress | Must |
| FR-6.13 | Input guardrails: prompt-injection screening on retrieved content and user input, jailbreak detection, off-topic rejection | Must |
| FR-6.14 | Output guardrails: grounding/citation check, PII leakage check, forbidden-claims check (no refund promises, no legal/medical advice), tone check | Must |
| FR-6.15 | Confidence signalling — the agent must be able to say "I don't know" and that must route to a human rather than produce a plausible guess | Must |
| FR-6.16 | Multi-turn interrupt handling: user changes topic mid-flow, agent abandons the current plan cleanly | Should |
| FR-6.17 | Visual or YAML-based agent/flow authoring in the control plane, not source-code edits | Should |

> **Orchestration pattern.** For a CX platform, a **supervisor with explicit handoffs** beats a free-form agent swarm. Customers need predictability and you need to be able to explain what happened. Start with: one router (cheap, fast model, classification only) → one specialist per domain → escalate to human. Add parallelism only where it demonstrably cuts latency.

### FR-7 — Knowledge Base & Retrieval

| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | Multiple source types: manual articles, file upload (PDF/DOCX/MD/HTML), website crawl, sitemap, API/DB sync | Must |
| FR-7.2 | Scheduled re-sync with change detection and content hashing; only changed chunks are re-embedded | Must |
| FR-7.3 | Chunking strategy configurable per source, structure-aware (respect headings, don't split tables/code) | Must |
| FR-7.4 | Hybrid retrieval — dense vectors + BM25/keyword — with reciprocal rank fusion. Pure vector search fails badly on product codes, SKUs and error codes | Must |
| FR-7.5 | Reranking pass over the fused candidate set | Should |
| FR-7.6 | Metadata filtering: locale, product line, audience (public/internal), effective date | Must |
| FR-7.7 | **KB scoping per agent** — the billing agent shouldn't retrieve engineering runbooks | Must |
| FR-7.8 | Citations returned with every retrieved answer, surfaced to the customer as links and to the reviewer as chunk IDs | Must |
| FR-7.9 | Freshness/expiry: articles carry a review date and stale ones are flagged in the admin UI | Should |
| FR-7.10 | Coverage-gap reporting: cluster questions where retrieval scored low or the agent escalated, and propose new articles | Should |
| FR-7.11 | Retrieval quality evaluation set (question → expected chunk) that runs in CI | Should |
| FR-7.12 | Re-embedding migration path when the embedding model changes — dual-write, backfill, cut over | Must |
| FR-7.13 | Treat retrieved content as untrusted input for injection purposes (a poisoned KB article is a real attack) | Must |

### FR-8 — Tools & Actions

| ID | Requirement | Priority |
|---|---|---|
| FR-8.1 | Tool registry with JSON Schema definitions, per-tenant and per-agent allowlists | Must |
| FR-8.2 | Tool types: HTTP/REST, database query, internal function, and MCP server | Must |
| FR-8.3 | **MCP client support** so you can consume any MCP server without writing an adapter — this is the cheapest route to a large tool library | Should |
| FR-8.4 | Per-tool auth: static key, OAuth on behalf of the tenant, or on behalf of the end user | Must |
| FR-8.5 | Read vs write classification. **Write tools require an approval policy**: auto, confirm-with-customer, or require-human-approval | Must |
| FR-8.6 | Idempotency keys on write tools so a retry never double-refunds | Must |
| FR-8.7 | Tool execution sandboxing, timeouts, and per-tool rate limits | Must |
| FR-8.8 | Argument validation against schema before execution, with a repair loop when the model produces invalid arguments | Must |
| FR-8.9 | Tool errors returned to the model as structured, actionable text ("order not found" not "500") so it can recover | Must |
| FR-8.10 | Every tool invocation logged with arguments, result, latency, and outcome — this is your audit trail when a customer disputes an action | Must |
| FR-8.11 | Dry-run/simulation mode for testing agents without touching production systems | Should |

### FR-9 — Human Agent Desk & Handoff

| ID | Requirement | Priority |
|---|---|---|
| FR-9.1 | Unified inbox across channels, with views: unassigned, mine, team, all, SLA-breaching | Must |
| FR-9.2 | Escalation triggers: explicit customer request, low agent confidence, guardrail block, sentiment/frustration detection, N failed turns, high-value customer flag, keyword rules | Must |
| FR-9.3 | **Handoff context package** shown to the human on open: AI-written summary, customer intent, what was already tried, tool calls made, KB articles used, sentiment, and account context | Must |
| FR-9.4 | Live takeover — human joins an active conversation; the bot is suspended, not killed | Must |
| FR-9.5 | Hand-back to bot with a summary of what the human did | Should |
| FR-9.6 | **Copilot / suggest mode**: bot drafts a reply, human edits and sends. This is often the right default before you trust autopilot | Must |
| FR-9.7 | Agent presence and capacity (online/away/offline, max concurrent conversations) | Must |
| FR-9.8 | Routing rules: round-robin, least-busy, skill-based (language, product area), with manual assignment override | Must |
| FR-9.9 | Internal notes and @mentions, invisible to the customer, plus internal-only side conversations | Must |
| FR-9.10 | Canned responses / macros with variable substitution, and macros that also perform actions (set status, add tag) | Should |
| FR-9.11 | Real-time typing sync so two humans don't answer the same ticket | Should |
| FR-9.12 | Queue position and estimated wait time shown to the customer when waiting for a human | Should |
| FR-9.13 | Out-of-hours behaviour: bot-only, or collect email and convert to a ticket | Must |
| FR-9.14 | Transfer between human agents with a reason note | Should |

> **Suggest before autopilot.** FR-9.6 is the highest-leverage requirement in this document. Running in copilot mode for a few weeks gives you a labelled dataset of "what the bot proposed vs what the human actually sent" — which is both your eval set and your evidence for when to switch on autopilot per intent category.

### FR-10 — Control Plane (Admin)

| ID | Requirement | Priority |
|---|---|---|
| FR-10.1 | Agent editor: prompt, model alias, tools, KB scope, handoff targets — with live preview against a test conversation | Must |
| FR-10.2 | Model alias management: map logical names to providers/models, set fallback chains, per-tenant | Must |
| FR-10.3 | KB management: sources, sync status, article CRUD, chunk inspection | Must |
| FR-10.4 | Tool management: register, configure auth, set approval policy, test-invoke | Must |
| FR-10.5 | Routing and escalation rule editor | Must |
| FR-10.6 | Widget/branding configuration with live preview | Must |
| FR-10.7 | Business hours, holidays, per-tenant timezone | Must |
| FR-10.8 | Team and role management | Must |
| FR-10.9 | Everything versioned with diff view and one-click rollback | Should |
| FR-10.10 | Config export/import as YAML or JSON, so config can live in git if you prefer | Should |

### FR-11 — Analytics & Reporting

| ID | Requirement | Priority |
|---|---|---|
| FR-11.1 | Volume: conversations, messages, by channel, by hour/day | Must |
| FR-11.2 | **Containment / deflection rate** — resolved without human involvement. The headline metric | Must |
| FR-11.3 | Escalation rate with breakdown by trigger reason | Must |
| FR-11.4 | First-response time, resolution time, SLA attainment | Must |
| FR-11.5 | CSAT collection (post-conversation thumbs or 1–5) and trend | Must |
| FR-11.6 | **Cost per conversation** and cost per resolution, by agent and by model | Must |
| FR-11.7 | Latency percentiles (p50/p95/p99) for time-to-first-token and time-to-complete-reply | Must |
| FR-11.8 | Intent/topic distribution with automatic clustering of unrecognised intents | Should |
| FR-11.9 | KB coverage gaps and top unanswered questions | Should |
| FR-11.10 | Per-human-agent productivity: handled, response time, CSAT | Should |
| FR-11.11 | Scheduled report export (CSV/email) | Could |

### FR-12 — Quality: Evaluation & Testing

Treat this as a first-class module, not an afterthought. It is the difference between a demo and a platform.

| ID | Requirement | Priority |
|---|---|---|
| FR-12.1 | Golden dataset of conversations with expected outcomes, versioned in the repo | Must |
| FR-12.2 | Offline eval runner in CI: retrieval accuracy, answer correctness, tool-selection accuracy, routing accuracy, refusal appropriateness | Must |
| FR-12.3 | LLM-as-judge scoring with a rubric, plus human spot-check sampling to validate the judge | Should |
| FR-12.4 | **Regression gate**: a prompt or model change that drops any metric below threshold fails the build | Must |
| FR-12.5 | Conversation replay — re-run a real past conversation against a new agent version and diff the outcome | Should |
| FR-12.6 | Online A/B testing with traffic splitting between agent versions or model aliases | Should |
| FR-12.7 | Hallucination/groundedness check: is every factual claim supported by a retrieved chunk? | Must |
| FR-12.8 | Adversarial/red-team suite: prompt injection, data exfiltration attempts, policy violations, abusive input | Must |
| FR-12.9 | Human review queue — sample N% of conversations for labelling, feeding back into FR-12.1 | Should |

### FR-13 — Observability

| ID | Requirement | Priority |
|---|---|---|
| FR-13.1 | Full trace per conversation turn: prompt sent, retrieved chunks, model response, tool calls, guardrail verdicts, timings, cost. Use OpenTelemetry semantics so you can point it at any backend | Must |
| FR-13.2 | Trace viewer in the admin UI — a support engineer must be able to answer "why did it say that?" in under a minute | Must |
| FR-13.3 | Structured logs with correlation IDs spanning channel → orchestrator → gateway → tool | Must |
| FR-13.4 | Metrics and alerting: error rate, provider failures, fallback rate, latency, queue depth, budget consumption | Must |
| FR-13.5 | Provider health dashboard showing per-provider availability and latency | Should |
| FR-13.6 | Prompt/response archival with configurable retention, separately governed from conversation retention | Must |

---

## 3. Non-Functional Requirements

### NFR-1 Performance

| ID | Requirement |
|---|---|
| NFR-1.1 | Time to first token ≤ 1.5 s p95 for widget conversations (this is what "feels fast" costs) |
| NFR-1.2 | Router classification ≤ 400 ms p95 — use a small model, this must not be on the critical path in a heavy way |
| NFR-1.3 | Retrieval ≤ 300 ms p95 |
| NFR-1.4 | Widget script load must not block page render; ≤ 50 KB gzipped |
| NFR-1.5 | Email first-response processing ≤ 60 s from receipt |

### NFR-2 Reliability

| ID | Requirement |
|---|---|
| NFR-2.1 | No single provider outage takes the platform down — fallback chains are mandatory, not optional |
| NFR-2.2 | Inbound messages are durably queued before processing; a worker crash never loses a customer message |
| NFR-2.3 | All external calls have timeouts and circuit breakers |
| NFR-2.4 | Graceful degradation ladder: full agent → KB-only search results → canned holding message + human escalation → email capture |
| NFR-2.5 | Zero-downtime deploys; in-flight conversations survive a rolling restart |
| NFR-2.6 | Target 99.9% availability for the widget endpoint |
| NFR-2.7 | Backups with a defined RPO (≤ 1 h) and RTO (≤ 4 h) covering database, vector store and object storage — and a restore that has actually been tested, not just configured |

### NFR-3 Scalability

| ID | Requirement |
|---|---|
| NFR-3.1 | Stateless application tier, horizontally scalable; conversation state in the database, not in process memory |
| NFR-3.2 | Background work (embedding, crawling, email polling, evals) runs on separate workers from the request path |
| NFR-3.3 | Per-tenant rate limiting so one tenant cannot starve another |
| NFR-3.4 | Vector store must handle at least 10× your current KB size without re-architecting |

### NFR-4 Security

| ID | Requirement |
|---|---|
| NFR-4.1 | Encryption in transit (TLS 1.3) and at rest |
| NFR-4.2 | Provider keys and tool credentials in a secret manager, never in the database in plaintext, never in logs |
| NFR-4.3 | Widget endpoints are origin-restricted per tenant and rate-limited per session and per IP |
| NFR-4.4 | Prompt-injection defence in depth: retrieved content is delimited and marked untrusted; tools that write require approval; the model never receives raw credentials |
| NFR-4.5 | Tenant isolation verified by automated tests that attempt cross-tenant reads |
| NFR-4.6 | Dependency scanning and SBOM in CI |
| NFR-4.7 | File uploads scanned and stored outside the web root with signed, expiring URLs |
| NFR-4.8 | Abuse handling — spam/flood detection, session and IP blocklists, an agent-side "end this conversation" action, and a cap on token spend per anonymous visitor |

### NFR-5 Privacy & Data Governance

| ID | Requirement |
|---|---|
| NFR-5.1 | Configurable retention per tenant per data class: transcripts, traces, prompts, attachments |
| NFR-5.2 | GDPR data-subject rights: export and erasure, cascading to traces, vector store and backups |
| NFR-5.3 | PII detection and optional redaction before data leaves your infrastructure to a model provider |
| NFR-5.4 | Data residency configuration — pin a tenant to EU-hosted providers and storage |
| NFR-5.5 | Data Processing Agreements tracked per provider; a register of which sub-processor sees what |
| NFR-5.6 | Zero-retention / no-training settings enabled on every provider account, and documented |

### NFR-6 Compliance

| ID | Requirement |
|---|---|
| NFR-6.1 | Audit trail of every automated action taken on a customer's behalf, immutable and exportable |
| NFR-6.2 | **AI disclosure at first interaction.** EU AI Act Article 50 transparency obligations became applicable on 2 August 2026 — customers must be clearly informed they are interacting with an AI, at the latest at the time of first interaction, in a clear and distinguishable way (not buried in a footer or T&Cs) |
| NFR-6.3 | Human-review path documented and reachable — the customer must always be able to get to a person |
| NFR-6.4 | Accessibility: widget meets WCAG 2.2 AA — keyboard navigable, screen-reader labelled, respects reduced-motion, sufficient contrast |
| NFR-6.5 | Cookie/consent handling for the widget's storage |

> **This one is live now, not hypothetical.** Article 50 applies as of three weeks ago. A visible "AI assistant" label in the widget header and an opening line that says so satisfies the plain reading; the exemption for cases where AI involvement is "obvious" is not something to lean on.

### NFR-7 Cost Control

| ID | Requirement |
|---|---|
| NFR-7.1 | Cost attributed per request → conversation → agent → tenant, queryable |
| NFR-7.2 | Hard budget ceilings with automatic degradation (fall back to a cheaper alias) before hard-stop |
| NFR-7.3 | Prompt caching and semantic response caching for repeated questions |
| NFR-7.4 | Cheap models for cheap jobs — routing, classification, summarisation, guardrails should never run on your most expensive model |
| NFR-7.5 | Alert on anomalous spend (e.g. 3× the trailing 7-day hourly average) |

### NFR-8 Internationalisation

| ID | Requirement |
|---|---|
| NFR-8.1 | Language detection on inbound messages; agent replies in the customer's language |
| NFR-8.2 | Localised UI strings for widget and admin |
| NFR-8.3 | Locale-aware KB retrieval with fallback to a default language |
| NFR-8.4 | RTL layout support in the widget |
| NFR-8.5 | Per-tenant timezone for business hours and SLA calculation |

### NFR-9 Maintainability

| ID | Requirement |
|---|---|
| NFR-9.1 | Layer boundaries enforced by module structure and lint rules, not convention |
| NFR-9.2 | Adding a new channel requires implementing one interface and touching no orchestrator code |
| NFR-9.3 | Adding a new model provider requires implementing one interface and adding a capability entry |
| NFR-9.4 | Every migration reversible; config schema versioned |
| NFR-9.5 | Local development runs the full stack without cloud dependencies (stub provider + local vector store) |

---

## 4. Data Model Sketch

Core entities. Every table carries `tenant_id`, `created_at`, `updated_at`.

```
Tenant            id, name, slug, settings, budget_config, residency
User              id, tenant_id, email, role, presence, capacity, skills[]
Customer          id, tenant_id, external_id, email, name, attributes{}, locale
Conversation      id, tenant_id, customer_id, channel, state, assignee_id,
                  current_agent_id, priority, tags[], sla_due_at, metadata{}
Message           id, conversation_id, role, content, content_type,
                  author_type, author_id, channel_message_id, visibility,
                  created_at, sequence
Event             id, conversation_id, type, payload{}, actor, created_at
                  -- append-only: state_changed, handoff, assigned, escalated
AgentDef          id, tenant_id, key, version, status(draft|published),
                  system_prompt, model_alias, params{}, tool_ids[],
                  kb_scope{}, handoff_targets[], guardrails{}
ModelAlias        id, tenant_id, alias, provider, model, params{},
                  fallback_chain[], capabilities{}
KBSource          id, tenant_id, type, config{}, last_sync_at, status
KBArticle         id, tenant_id, source_id, title, body, url, locale,
                  metadata{}, content_hash, review_due_at
KBChunk           id, article_id, ordinal, text, embedding_model,
                  embedding_ref, token_count
ToolDef           id, tenant_id, key, type, schema{}, auth_ref,
                  write_flag, approval_policy, rate_limit
Run               id, conversation_id, agent_def_id, agent_version,
                  trigger, status, started_at, ended_at,
                  total_tokens, total_cost, iteration_count
LLMCall           id, run_id, model_alias, provider, model, request_hash,
                  prompt_tokens, completion_tokens, cached_tokens,
                  cost, latency_ms, fallback_used, error_type
ToolCall          id, run_id, tool_def_id, arguments{}, result{},
                  status, latency_ms, approved_by
Ticket            id, tenant_id, conversation_id, subject, status,
                  priority, category, assignee_id, due_at
EvalCase          id, tenant_id, input, expected{}, tags[]
EvalRun           id, agent_def_id, agent_version, dataset_version,
                  metrics{}, created_at
AuditLog          id, tenant_id, actor_id, action, target, before{},
                  after{}, ip, created_at
```

**Notes.**

- `Run` is the unit that ties a customer turn to everything the system did in response. Almost every debugging and cost question is answered by joining from here.
- `KBChunk.embedding_model` exists so that a model swap is detectable rather than silently degrading retrieval.
- `Event` being append-only is what lets you reconstruct "what state was this conversation in at 14:32?" — which you will need the first time a customer complains.
- Keep `Message.visibility` (`public` / `internal`) rigorous. One bug here leaks an internal note to a customer.

---

## 5. Key Decisions to Make Up Front

These are the choices that are cheap now and expensive in six months.

| Decision | Options | Recommendation |
|---|---|---|
| Orchestration style | Supervisor + explicit handoff / free-form swarm / static flowchart | **Supervisor + handoff.** Predictable, explainable, still flexible |
| Agent definition | Code / database records / YAML in git | **Database records with export to YAML.** Non-devs can edit, devs can version |
| Vector store | pgvector / Qdrant / Weaviate / managed | **pgvector** if Postgres is already there — one fewer system, and hybrid search with `tsvector` is straightforward |
| Model gateway | Build adapters / LiteLLM / OpenRouter | Build the thin internal interface yourself; optionally put a gateway behind it |
| Streaming transport | SSE / WebSocket | **SSE** for bot→customer (simpler, proxies well); WebSocket only if you need bidirectional presence in the agent desk |
| Job queue | BullMQ+Redis / pg-boss / SQS | **pg-boss** if avoiding Redis, **BullMQ** if you already have Redis |
| Conversation concurrency | Per-conversation lock / serialised queue / cancel-and-restart | **Cancel-and-restart with a debounce window** — best UX |
| Tool integration | Custom adapters / MCP | **MCP where possible** — the ecosystem does the work for you |
| Human desk UI | Build / embed into existing helpdesk | Build minimal; it's the part where "good enough" is genuinely good enough at your scale |

---

## 6. Phased Roadmap

### Phase 0 — Refactor the foundation *(the unglamorous prerequisite)*

Take what you have and impose the boundaries. No new features.

- Canonical message and conversation types
- Model gateway interface + two provider adapters + capability matrix
- Agent definitions moved from code to records
- Tenant ID threaded through the data layer
- Basic tracing on every LLM call

**Exit criterion:** you can swap the underlying model by editing one config row, and nothing else in the codebase changes.

### Phase 1 — MVP *(the cut line)*

Everything below is in. Everything above it in this document that isn't listed here is deliberately deferred.

**In scope:**

- Web widget: embed, stream, persist, brand, AI disclosure, offline email capture
- Email ingestion + threading + outbound, basic ticket lifecycle
- Conversation core with state machine and event log
- Model gateway with fallback chains and cost accounting
- Router agent + 2–3 specialist agents + explicit handoff
- KB: manual articles + file upload + website crawl; hybrid retrieval with citations
- Tools: HTTP + MCP client, read-only auto, writes require confirmation
- Human desk: unified inbox, escalation triggers, context package, takeover, **copilot mode**, internal notes
- Admin: agent editor, model aliases, KB management, widget config, business hours
- Analytics: volume, containment, escalation reasons, CSAT, cost per conversation, latency
- Tracing with an in-app trace viewer
- Guardrails: injection screening, groundedness check, forbidden-claims check
- Eval: golden dataset + CI regression gate
- Retention config, GDPR export/erasure, audit log

**Explicitly deferred to later phases:** messaging apps, voice, SLA policy engine, skill-based routing, A/B testing, visual flow builder, agent-performance analytics, macros, ticket merge/split, proactive triggers, semantic response cache, self-serve tenant onboarding.

> **Honest scope check.** Phase 1 as written is roughly four to six months of solo work. If you need something live sooner, the six-week version is: widget only (no email), one agent (no router), KB with hybrid retrieval, read-only tools, human takeover in copilot mode, cost tracking, tracing. Everything else in Phase 1 moves to Phase 1b. The Phase 0 boundaries are the part that must not be cut — they are what make the shortcut survivable.

**Suggested sequence within Phase 1:** widget end-to-end first (it's the shortest path to a real conversation), then human desk in copilot mode, then multi-agent routing, then email, then analytics and evals. Resist building the admin UI before the runtime works — configure via seed scripts until the shape is stable.

### Phase 2 — Depth

Sentiment-based escalation, skill-based routing, SLA engine, macros, agent-performance analytics, A/B testing of agent versions, conversation replay, coverage-gap reporting, semantic caching, human review queue.

### Phase 3 — Reach

Messaging channels (WhatsApp/Telegram), proactive outbound, visual flow builder, self-serve tenant onboarding, voice.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Model abstraction leaks and you end up locked in anyway | Enforce with a lint rule that bans provider SDK imports outside `providers/`; ship a stub provider used in all tests |
| Multi-agent routing misfires and customers get the wrong specialist | Router accuracy is an eval metric with a CI gate; log every routing decision with confidence; fall back to a generalist on low confidence |
| Hallucinated answers cause real customer harm | Groundedness guardrail, citations always, copilot mode before autopilot, forbidden-claims list |
| Costs run away silently | Per-conversation budget guards from day one, not "later"; anomaly alerting |
| Prompt injection via a poisoned KB article or a crafted email | Untrusted-content delimiting, write-tool approval, no credentials in context, red-team suite in CI |
| Building the admin UI consumes the whole timeline | Seed scripts and YAML config until the runtime is proven; UI last within each phase |
| Multi-tenancy bolted on later requires a rewrite | `tenant_id` from Phase 0, enforced at the repository layer, with cross-tenant access tests |

---

## 8. Open Questions

1. Is multi-tenancy for your own brands, or is a SaaS product the eventual goal? (Changes billing, onboarding, isolation strictness.)
2. Expected volume — conversations per day at launch and at 12 months?
3. Which systems must the tools reach? (Order database, CRM, payment provider, internal APIs?)
4. How many human agents, and are they full-time support staff or people doing this alongside other work? (Drives how much the desk UI needs.)
5. Data residency requirements — EU-only, or is US-hosted inference acceptable?
6. Do you already have Postgres and Redis in your stack? (Decides queue and vector store.)
7. Is there an existing helpdesk (Zendesk, Freshdesk, HelpScout) this must coexist with or replace?
8. What languages must you support at launch?

---

## Sources

- [EU AI Act Article 50 transparency rules](https://artificialintelligenceact.eu/transparency-rules-article-50/)
- [EU AI Act compliance checklist for customer support](https://www.typewise.app/blog/ai-act-compliance-customer-support-checklist)
- [OpenRouter vs LiteLLM gateway comparison](https://techjacksolutions.com/ai-tools/llm-gateways/openrouter-vs-litellm/)
- [LiteLLM alternatives and gateway comparison](https://qveris.ai/guides/litellm-alternative-comparison/)
- [Multi-agent orchestration patterns for production](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production)
- [AI agent design patterns — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [AI agent observability, tracing and evaluation](https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse)
