# Graph Report - cx-platform  (2026-08-21)

## Corpus Check
- 151 files · ~55,476 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 995 nodes · 2200 edges · 114 communities (54 shown, 60 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 101 edges (avg confidence: 0.81)
- Token cost: 0 input · 114,414 output

## Community Hubs (Navigation)
- Seed Script & Router Bootstrap
- Email Inbound Webhook
- Model Gateway Providers
- Router/Handoff Desk UI & Loop Prevention
- Staff Auth Routes & Desk Page
- TypeScript Project Config
- Web Widget Chat Panel
- Return Eligibility Rule Engine
- KB Article Repository
- Desk Approval/Draft/Handback Routes
- Eval Harness Runner
- Runtime Dependencies
- Email/Ticketing Channel (M2)
- Dev Tooling Dependencies
- Amarelle Formatting Helpers
- CI Workflow & Eval Gate (FR-12)
- Canonical Message Types & Repository
- Cancel-Order Write Tool
- Desk Conversation Page & Composer
- Widget Card Renderers
- Schema Migration Runner
- Write-Tool Approval Gate (M3)
- Amarelle Knowledge Base Articles
- Run/LLM-Call/Ticket Repositories
- Conversation Repository & Types
- Tool Approval Repository
- Human Desk Copilot Mode (Phase 1)
- Amarelle Business-Data Repo
- Repo Rules & Requirements Doc
- Conversation Lock & Loop Prevention
- Tool Def Repository
- Widget Chat Route
- npm Scripts
- Conversation Event Log
- LLM Call Repository & Fallback
- Staff Session Repository
- Product Search Tool
- Guardrail Suite (M4)
- Audit Log Repository
- Hybrid KB Retrieval
- Tool Registry Error Handling (FR-8.9/8.10)
- Widget Channel & AI Disclosure
- Demo Date Clock Invariant
- Gateway Boundary Invariant
- Skin Reaction Safety Path
- package.json Metadata
- Router Classification (FR-6.6)
- Model Capability Matrix
- Tenant-Scoped Repository Pattern
- Deterministic Escalation Triggers
- Root Layout
- Staff Login Page
- In-Memory Session Store Invariant
- Per-Tenant Model Alias Binding
- Agent Defs as DB Records
- EU AI Act Disclosure Requirement
- ESLint JS Config Dependency
- Fragrance & Essential Oils
- Loyalty Programme
- Defect & Transit Damage Handling
- Return Shipping / RMA Window
- Standard Return Window & Dates
- Next.js Config
- Next.js Env Types
- Tailwind CSS Dependency
- Tailwind PostCSS Plugin
- tsx Runtime Dependency
- React DOM Types
- PostCSS Config
- Data Model Sketch
- FR-10 Control Plane Requirement
- FR-11 Analytics Requirement
- FR-12 Evals & Testing Requirement
- FR-13 Observability Requirement
- FR-1 Tenancy Requirement
- FR-2 Identity/Auth/RBAC Requirement
- FR-3 Channel Layer Requirement
- FR-4 Conversation Core Requirement
- FR-5 Model Gateway Requirement
- FR-6 Agent Orchestration Requirement
- FR-7 Knowledge Base Requirement
- FR-8 Tools & Actions Requirement
- FR-9 Human Desk Requirement
- Key Architecture Decisions
- Nine-Layer Architecture
- Phased Roadmap
- CX Platform Requirements Spec
- Amarelle Brand Identity
- Sourcing & Formulation Philosophy
- Sustainability Commitments
- Skincare Routine Building
- Skin Profile Types
- Gift Cards
- Payment Methods
- Advisor Medical Boundaries
- Animal Testing Policy
- Patch Testing Guidance
- Shelf Life & PAO
- Order Cancellation
- Non-Returnable Items
- Refund Issuance Method
- Delivery Address Changes
- Delivery Options
- International Delivery
- Order Status Values
- Order Tracking
- Copilot Studio Changelog
- Delivering Bad News Style
- Amarelle System Prompt
- Assistant Role & Scope
- Severe Symptom Signal Hook
- Tool Sequencing Rule

## God Nodes (most connected - your core abstractions)
1. `TenantContext` - 52 edges
2. `ChatResponse` - 42 edges
3. `TenantScopedRepository` - 34 edges
4. `processInboundTurn()` - 29 edges
5. `createDb()` - 28 edges
6. `ChatRequest` - 27 edges
7. `runAgentTurn()` - 26 edges
8. `ConversationRepository` - 25 edges
9. `ProviderAdapter` - 25 edges
10. `getPlatformContext()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `CI Workflow` --semantically_similar_to--> `Before Committing Checklist`  [INFERRED] [semantically similar]
  .github/workflows/ci.yml → CLAUDE.md
- `processInboundTurn()` --shares_data_with--> `app/api/chat/route.ts`  [EXTRACTED]
  src/channel/turn.ts → README.md
- `src/tools/ tool registry` --shares_data_with--> `executeTool()`  [INFERRED]
  README.md → src/tools/registry.ts
- `HandoffPackage` --references--> `FR-6.7`  [EXTRACTED]
  src/agents/handoff.ts → README.md
- `Phase 1b M5/M6: Router + Handoff Protocol` --references--> `runRouterTurn()`  [EXTRACTED]
  README.md → src/agents/router.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Skin Reaction Overrides Return Rules — Cross-Doc Enforcement** — knowledge_product_safety_and_ingredients_reporting_skin_reaction, knowledge_returns_and_refunds_policy_skin_reaction_return_exception, prompts_system_prompt_skin_reactions_rule [INFERRED 0.90]
- **Phase 1b Milestones (M1-M7)** — readme_phase_1b, readme_phase1b_m1, readme_phase1b_m2, readme_phase1b_m3, readme_phase1b_m4, readme_phase1b_m5m6, readme_phase1b_m7 [EXTRACTED 1.00]
- **Write-Tool Approval Gate Flow** — claude_invariant_write_tool_approval_gate, src_tools_registry_executetool, claude_tool_defs_approval_policy, claude_tool_calls_idempotency_key, src_tools_amarelle_cancel_order_cancelorder, readme_tool_approvals_table [INFERRED 0.90]
- **FR/NFR Requirement Codes Traced to docs/00-requirements.md** — docs_00_requirements_doc, readme_fr_5_12, readme_nfr_1_1, readme_fr_7_4, readme_fr_7_6, readme_fr_7_7, readme_fr_8_9, readme_fr_8_10, readme_fr_6_2, readme_fr_6_12, readme_nfr_6_2, readme_fr_9_6, readme_fr_13_2, readme_fr_11_6, readme_nfr_9_2, readme_fr_7_13, readme_fr_6_1, readme_fr_6_6, readme_fr_6_7, readme_fr_6_8, readme_fr_9_3, readme_fr_12_1, readme_fr_12_2, readme_nfr_9_5, _github_workflows_ci_fr_12_4, _github_workflows_ci_fr_12_3 [INFERRED 0.85]

## Communities (114 total, 60 thin omitted)

### Community 0 - "Seed Script & Router Bootstrap"
Cohesion: 0.06
Nodes (67): main(), scripts/seed.ts, RouterResult, RuntimeDeps, buildCorePrompt(), buildRouterPrompt(), SessionContext, createDb() (+59 more)

### Community 1 - "Email Inbound Webhook"
Cohesion: 0.08
Nodes (28): emailProvider(), headersToRecord(), POST(), PostmarkInboundPayload, runtime, RFC-3676, EMAIL_CAPABILITIES, EmailChannelAdapter (+20 more)

### Community 2 - "Model Gateway Providers"
Cohesion: 0.08
Nodes (16): ScriptedProvider, AnthropicProvider, DEFAULT_PRICING, estimateCostUsd(), mapError(), mapStopReason(), PRICING_PER_MILLION_USD, ChatRequest (+8 more)

### Community 3 - "Router/Handoff Desk UI & Loop Prevention"
Cohesion: 0.08
Nodes (40): Agent-path breadcrumb + handoff context UI, conversations.metadata.agentPath, Copilot-draft hardcoded support-generalist bug fix, FR-6.7, FR-6.8, FR-9.3, Phase 1b M5/M6: Router + Handoff Protocol, HUMAN_REQUEST_MARKERS (+32 more)

### Community 4 - "Staff Auth Routes & Desk Page"
Cohesion: 0.09
Nodes (27): POST(), runtime, POST(), runtime, CHANNEL_FILTERS, DeskPage(), dynamic, SignOutButton() (+19 more)

### Community 5 - "TypeScript Project Config"
Cohesion: 0.06
Nodes (33): app/**/*.ts, app/**/*.tsx, components/**/*.ts, components/**/*.tsx, dom, dom.iterable, ES2022, .next/dev/types/**/*.ts (+25 more)

### Community 6 - "Web Widget Chat Panel"
Cohesion: 0.12
Nodes (18): ChatPanel(), PHASE_BANNER, SUGGESTIONS, ChatContext, ChatContextValue, ChatMessage, ChatProvider(), ConversationPhase (+10 more)

### Community 7 - "Return Eligibility Rule Engine"
Cohesion: 0.10
Nodes (23): ALTERNATIVE_ACTION_MAP, CheckReturnEligibilityInput, checkReturnEligibilityInputSchema, checkReturnEligibilityToolDef, CustomerRow, LineRow, OrderRow, ProductRow (+15 more)

### Community 8 - "KB Article Repository"
Cohesion: 0.14
Nodes (13): KbArticle, KbArticleRepository, KbArticleRow, KbChunk, KbChunkRepository, KbChunkRow, rowToArticle(), rowToChunk() (+5 more)

### Community 9 - "Desk Approval/Draft/Handback Routes"
Cohesion: 0.18
Nodes (15): POST(), runtime, runtime, POST(), runtime, POST(), runtime, getOrCreateSession() (+7 more)

### Community 10 - "Eval Harness Runner"
Cohesion: 0.17
Nodes (18): main(), moduleDir, runCase(), THRESHOLD_DESCRIPTIONS, toFullResponse(), AssertionFailure, CaseResult, checkThresholds() (+10 more)

### Community 11 - "Runtime Dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, bcryptjs, better-sqlite3, csv-parse, dotenv, next, nodemailer, dependencies (+13 more)

### Community 12 - "Email/Ticketing Channel (M2)"
Cohesion: 0.13
Nodes (11): app/api/channels/email/inbound/route.ts, POST(), NFR-9.2 (one interface promise), Phase 1b M2: Email/Ticketing Channel, src/channel/, src/channel/email/ (threading, quoted-reply stripping, autoresponder guard, ticket lifecycle), ensureConversation(), processInboundTurn() (+3 more)

### Community 13 - "Dev Tooling Dependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, @types/bcryptjs, @types/better-sqlite3, @types/node (+13 more)

### Community 14 - "Amarelle Formatting Helpers"
Cohesion: 0.17
Nodes (17): formatDayMonth(), formatWeekday(), money(), MONTHS, STATUS_LABELS, statusLabel(), WEEKDAYS, buildOrderResult() (+9 more)

### Community 15 - "CI Workflow & Eval Gate (FR-12)"
Cohesion: 0.12
Nodes (19): FR-12.3 (LLM-as-judge subset, not built), FR-12.4 (deterministic regression gate), CI Workflow, npm run eval (CI step, golden-dataset gate), npm run lint (CI step), npm test (CI step), npm run typecheck (CI step), FR-12.1 (+11 more)

### Community 16 - "Canonical Message Types & Repository"
Cohesion: 0.20
Nodes (9): GET(), runtime, CanonicalMessage, MessageRole, MessageVisibility, MessageRepository, MessageRow, MessageThreadRow (+1 more)

### Community 17 - "Cancel-Order Write Tool"
Cohesion: 0.22
Nodes (12): ToolDefinition, CancelOrderInput, cancelOrderInputSchema, cancelOrderToolDef, runCancelOrder(), canonicalize(), computeIdempotencyKey(), executeApprovedTool() (+4 more)

### Community 18 - "Desk Conversation Page & Composer"
Cohesion: 0.16
Nodes (8): DeskConversationPage(), dynamic, ApprovalsPanel(), PendingApproval, DeskComposer(), rowToRecord(), rowToToolCall(), ToolCallRepository

### Community 19 - "Widget Card Renderers"
Cohesion: 0.21
Nodes (11): CardRenderer(), OrderStatusCard(), TONE_CLASSES, ProductResultsCard(), RefusalCard(), CardPayload, OrderStatusCard, ProductResultCard (+3 more)

### Community 20 - "Schema Migration Runner"
Cohesion: 0.27
Nodes (8): Migration, runMigrations(), migration001MessagesRebuildAndThreading, migration002RbacAndAudit, migration003ConversationsAssignee, migration004Tickets, migration005ToolApprovals, ALL_MIGRATIONS

### Community 21 - "Write-Tool Approval Gate (M3)"
Cohesion: 0.15
Nodes (14): app/api/desk/[conversationId]/approvals/[approvalId]/route.ts, create_return tool (does not exist yet), Invariant: Write Tools Require Approval Policy Gate, tool_calls.idempotency_key field, tool_defs.approval_policy field, Pending approvals panel (desk UI), Phase 1b M3: Write Tools + Approval Policy, Phase 1b Completion Summary (+6 more)

### Community 22 - "Amarelle Knowledge Base Articles"
Cohesion: 0.15
Nodes (14): About Amarelle Botanique, Choosing the Right Product, Refills (AB-RF Reference), General Questions FAQ, Ingredient and Allergen Questions, Product Safety and Ingredients, Returns and Refunds Policy, Sealed vs Opened Products — Hygiene Requirement (+6 more)

### Community 23 - "Run/LLM-Call/Ticket Repositories"
Cohesion: 0.18
Nodes (8): LlmCallRecord, LlmCallRow, Run, RunRow, Ticket, TicketPriority, TicketRow, TicketStatus

### Community 24 - "Conversation Repository & Types"
Cohesion: 0.33
Nodes (6): Conversation, ConversationChannel, ConversationState, ConversationRepository, ConversationRow, rowToConversation()

### Community 25 - "Tool Approval Repository"
Cohesion: 0.26
Nodes (6): rowToApproval(), ToolApproval, ToolApprovalRepository, ToolApprovalRow, ToolApprovalStatus, ApprovalPolicy

### Community 26 - "Human Desk Copilot Mode (Phase 1)"
Cohesion: 0.17
Nodes (12): app/api/desk/ handlers, app/desk/ human desk UI, FR-11.6, FR-13.2, FR-9.6, Phase 1b M1: Migrations + Staff RBAC, Per-turn trace panel, users/sessions/audit_log tables (+4 more)

### Community 27 - "Amarelle Business-Data Repo"
Cohesion: 0.24
Nodes (3): runCheckReturnEligibility(), runLookupOrder(), AmarelleRepo

### Community 28 - "Repo Rules & Requirements Doc"
Cohesion: 0.24
Nodes (11): Amarelle Botanique (Tenant), Before Committing Checklist, Invariant: Amarelle Botanique Is Tenant Data, Not Platform Code, CX Platform Repo Rules (CLAUDE.md), docs/00-requirements.md, FR-5.12, Phase 0 (foundation), Phase 1 (six-week cut) (+3 more)

### Community 29 - "Conversation Lock & Loop Prevention"
Cohesion: 0.25
Nodes (8): locks, withConversationLock(), appendToPath(), detectCycle(), AgentTurnCallbacks, EscalationReason, ProcessTurnResult, ROUTER_AGENT_KEY

### Community 30 - "Tool Def Repository"
Cohesion: 0.24
Nodes (6): rowToToolDef(), ToolCallRecord, ToolCallRow, ToolDef, ToolDefRepository, ToolDefRow

### Community 31 - "Widget Chat Route"
Cohesion: 0.27
Nodes (7): clientIp(), POST(), runtime, widgetAdapter, checkIpRateLimit(), conversationTurnCapExceeded(), ipHits

### Community 32 - "npm Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, eval, ingest-kb, lint, seed, start (+2 more)

### Community 33 - "Conversation Event Log"
Cohesion: 0.31
Nodes (6): ConversationEvent, ConversationEventType, EventRepository, EventRow, rowToEvent(), TenantScopedRepository

### Community 34 - "LLM Call Repository & Fallback"
Cohesion: 0.29
Nodes (3): LlmCallRepository, TenantContext, ToolSpec

### Community 35 - "Staff Session Repository"
Cohesion: 0.25
Nodes (4): rowToSession(), Session, SessionRepository, SessionRow

### Community 36 - "Product Search Tool"
Cohesion: 0.22
Nodes (7): CONCERNS, PRODUCT_LINES, runSearchProducts(), SearchProductsInput, searchProductsInputSchema, searchProductsToolDef, SKIN_PROFILES

### Community 37 - "Guardrail Suite (M4)"
Cohesion: 0.25
Nodes (8): agent_defs.guardrails column, blockingMode (opt-in per agent), Forbidden-claims marker list, FR-7.13, Output groundedness check, Phase 1b M4: Guardrail Suite, PII-leakage heuristic, src/guardrails/

### Community 38 - "Audit Log Repository"
Cohesion: 0.29
Nodes (4): AuditLogEntry, AuditLogRepository, AuditLogRow, rowToEntry()

### Community 39 - "Hybrid KB Retrieval"
Cohesion: 0.29
Nodes (7): FR-7.4, FR-7.6, FR-7.7, kb_scope audience filtering, Reciprocal Rank Fusion, SQLite FTS5 (porter-stemmed), src/kb/ hybrid retrieval

### Community 40 - "Tool Registry Error Handling (FR-8.9/8.10)"
Cohesion: 0.33
Nodes (6): FR-8.10, FR-8.9, src/tools/amarelle/check-return-eligibility.ts, src/tools/amarelle/lookup-order.ts, src/tools/amarelle/search-products.ts, src/tools/ tool registry

### Community 41 - "Widget Channel & AI Disclosure"
Cohesion: 0.40
Nodes (5): app/api/chat/route.ts, components/chat/ web widget, handoff event + polling fallback, NFR-6.2 (AI disclosure), SSE streaming

### Community 42 - "Demo Date Clock Invariant"
Cohesion: 0.40
Nodes (5): amarelle-handoff ORD-100001 case, DEMO_DATE env var, Invariant: Inject Clock via today(), Never new Date(), amarelle-handoff (external demo repo), tests/tools.test.ts REACTION-window case

### Community 43 - "Gateway Boundary Invariant"
Cohesion: 0.40
Nodes (5): Invariant: No Provider SDK Crosses Gateway Boundary, eslint.config.mjs no-restricted-imports rule, NFR-1.1, src/gateway/ chatStream(), src/gateway/providers/*.ts adapters

### Community 44 - "Skin Reaction Safety Path"
Cohesion: 0.60
Nodes (5): Company Values — Plant-First, Transparency, Reaction-as-Safety, Reporting a Skin Reaction (Product Safety Case), Skin Reaction Return Exception (90 Days, Any Opened State), Skin Reactions Rule, Internal Escalation Guide (Fixture)

### Community 45 - "package.json Metadata"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 46 - "Router Classification (FR-6.6)"
Cohesion: 0.40
Nodes (5): FR-6.1, FR-6.6, handoffTargets column, route_to_agent forced-shape tool, runRouterTurn()

### Community 47 - "Model Capability Matrix"
Cohesion: 0.50
Nodes (3): CAPABILITY_MATRIX, getCapabilities(), ModelCapabilities

### Community 48 - "Tenant-Scoped Repository Pattern"
Cohesion: 0.50
Nodes (4): Invariant: TenantScopedRepository Pattern, TenantContext, TenantRepository, TenantScopedRepository

### Community 49 - "Deterministic Escalation Triggers"
Cohesion: 0.50
Nodes (4): Deterministic escalation triggers, FR-6.12, FR-6.2, src/agents/ agent runtime

### Community 52 - "In-Memory Session Store Invariant"
Cohesion: 0.67
Nodes (3): Invariant: In-Memory Session Store Is a Known Simplification, NFR-3.1 (multi-instance deploy), src/agents/sessions-store.ts (in-memory session store)

### Community 53 - "Per-Tenant Model Alias Binding"
Cohesion: 0.67
Nodes (3): Invariant: Model Bindings Are Per-Tenant Aliases, model_aliases table, tests/gateway-swap.test.ts

## Knowledge Gaps
- **323 isolated node(s):** `runtime`, `runtime`, `runtime`, `PostmarkInboundPayload`, `runtime` (+318 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **60 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `executeTool()` connect `Cancel-Order Write Tool` to `Seed Script & Router Bootstrap`, `Router/Handoff Desk UI & Loop Prevention`, `Tool Registry Error Handling (FR-8.9/8.10)`, `Desk Conversation Page & Composer`, `Write-Tool Approval Gate (M3)`, `Tool Approval Repository`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `TenantContext` connect `LLM Call Repository & Fallback` to `Seed Script & Router Bootstrap`, `Email Inbound Webhook`, `Router/Handoff Desk UI & Loop Prevention`, `Staff Auth Routes & Desk Page`, `Return Eligibility Rule Engine`, `KB Article Repository`, `Email/Ticketing Channel (M2)`, `Amarelle Formatting Helpers`, `Canonical Message Types & Repository`, `Cancel-Order Write Tool`, `Desk Conversation Page & Composer`, `Run/LLM-Call/Ticket Repositories`, `Conversation Repository & Types`, `Tool Approval Repository`, `Amarelle Business-Data Repo`, `Tool Def Repository`, `Conversation Event Log`, `Staff Session Repository`, `Product Search Tool`, `Audit Log Repository`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `CX Platform README Overview` connect `Repo Rules & Requirements Doc` to `Hybrid KB Retrieval`, `Tool Registry Error Handling (FR-8.9/8.10)`, `Widget Channel & AI Disclosure`, `Demo Date Clock Invariant`, `Gateway Boundary Invariant`, `Deterministic Escalation Triggers`, `Write-Tool Approval Gate (M3)`, `Human Desk Copilot Mode (Phase 1)`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `processInboundTurn()` (e.g. with `.getLatestPublished()` and `.getVersion()`) actually correct?**
  _`processInboundTurn()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `runtime`, `runtime`, `runtime` to the rest of the system?**
  _323 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Seed Script & Router Bootstrap` be split into smaller, more focused modules?**
  _Cohesion score 0.055622188905547224 - nodes in this community are weakly interconnected._
- **Should `Email Inbound Webhook` be split into smaller, more focused modules?**
  _Cohesion score 0.08208020050125313 - nodes in this community are weakly interconnected._