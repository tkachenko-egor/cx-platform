# Graph Report - cx-platform  (2026-08-21)

## Corpus Check
- 63 files · ~70,346 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1178 nodes · 2655 edges · 129 communities (62 shown, 67 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 117 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Staff Auth & Analytics Surfaces
- Escalation Scanners & Markers
- Email Inbound Webhook
- Web Widget Chat UI
- Core Bootstrap & Test Fixtures
- Model Gateway Providers
- A/B Experiment Admin API
- TypeScript Project Config
- Migration Framework & History
- Model Alias Repository
- Eval Harness Runner
- KB Ingest & Seed Scripts
- Return Eligibility Tool
- Widget Chat API Route
- Router & Agent Def Repository
- NPM Runtime Dependencies
- Lint & Dev Tooling Config
- SLA Engine & Core Types
- CI Pipeline Workflow
- Cancel Order Write Tool
- Amarelle Formatting Helpers
- Conversation Repository & Email Channel
- Macro & Review Queue Repositories
- Conversation Messages API
- Tool Approval Workflow
- Tool Call Repository
- Conversation Replay Timeline
- Write Tool Approval Docs
- Amarelle KB Articles
- KB Chunking & Ingestion
- Desk API & Cost Tracking Docs
- Macros API & Repository
- Desk List Page & Clock
- Agent Handoff Path & Loop Prevention
- KB Article & Chunk Repository
- Repo Rules & Requirements Docs
- Cost Analytics & Ticket Repo
- Agent Experiment Repository
- Amarelle Business Repo Methods
- NPM Package Scripts
- KB Coverage-Gap Reporting
- Search Products Tool
- Desk Conversation Detail Page
- Session Repository
- Review Queue API
- Guardrail Policy Docs
- Audit Log Repository
- LLM Call Repository
- Hybrid Retrieval Docs
- Tool Registry & Handlers
- KB Article Repository
- SSE Streaming Docs
- Demo Date & Handoff Fixture
- Gateway Boundary Invariant
- Skin Reaction Escalation Rule
- Package Metadata
- Model Capability Matrix
- Agent Runtime Test Provider
- Channel Turn Test Provider
- Guardrails Test Provider
- KB Test Provider
- Router Handoff Test Provider
- Semantic Cache Test Provider
- Tenant Scoping Invariant
- Escalation Triggers Doc
- Root App Layout
- Staff Login Page
- In-Memory Session Store
- Model Alias Invariant
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127

## God Nodes (most connected - your core abstractions)
1. `TenantContext` - 58 edges
2. `TenantScopedRepository` - 37 edges
3. `ConversationRepository` - 33 edges
4. `createDb()` - 30 edges
5. `getPlatformContext()` - 30 edges
6. `ChatResponse` - 28 edges
7. `TenantRepository` - 26 edges
8. `ChatRequest` - 25 edges
9. `processInboundTurn()` - 25 edges
10. `ProviderAdapter` - 23 edges

## Surprising Connections (you probably didn't know these)
- `CI Workflow` --semantically_similar_to--> `Before Committing Checklist`  [INFERRED] [semantically similar]
  .github/workflows/ci.yml → CLAUDE.md
- `src/tools/ tool registry` --shares_data_with--> `executeTool()`  [INFERRED]
  README.md → src/tools/registry.ts
- `processInboundTurn()` --shares_data_with--> `app/api/chat/route.ts`  [EXTRACTED]
  src/channel/turn.ts → README.md
- `Phase 1b M7: Eval Harness + CI Gate` --references--> `seedFixtures()`  [EXTRACTED]
  README.md → src/testing/seed-fixtures.ts
- `seedFixtures()` --shares_data_with--> `scripts/eval/run-eval.ts`  [EXTRACTED]
  src/testing/seed-fixtures.ts → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 1b Milestones (M1-M7)** — readme_phase_1b, readme_phase1b_m1, readme_phase1b_m2, readme_phase1b_m3, readme_phase1b_m4, readme_phase1b_m5m6, readme_phase1b_m7 [EXTRACTED 1.00]
- **FR/NFR Requirement Codes Traced to docs/00-requirements.md** — docs_00_requirements_doc, readme_fr_5_12, readme_nfr_1_1, readme_fr_7_4, readme_fr_7_6, readme_fr_7_7, readme_fr_8_9, readme_fr_8_10, readme_fr_6_2, readme_fr_6_12, readme_nfr_6_2, readme_fr_9_6, readme_fr_13_2, readme_fr_11_6, readme_nfr_9_2, readme_fr_7_13, readme_fr_6_1, readme_fr_6_6, readme_fr_6_7, readme_fr_6_8, readme_fr_9_3, readme_fr_12_1, readme_fr_12_2, readme_nfr_9_5, _github_workflows_ci_fr_12_4, _github_workflows_ci_fr_12_3 [INFERRED 0.85]
- **Skin Reaction Overrides Return Rules — Cross-Doc Enforcement** — knowledge_product_safety_and_ingredients_reporting_skin_reaction, knowledge_returns_and_refunds_policy_skin_reaction_return_exception, prompts_system_prompt_skin_reactions_rule [INFERRED 0.90]
- **Write-Tool Approval Gate Flow** — claude_invariant_write_tool_approval_gate, src_tools_registry_executetool, claude_tool_defs_approval_policy, claude_tool_calls_idempotency_key, src_tools_amarelle_cancel_order_cancelorder, readme_tool_approvals_table [INFERRED 0.90]

## Communities (129 total, 67 thin omitted)

### Community 0 - "Staff Auth & Analytics Surfaces"
Cohesion: 0.05
Nodes (44): dynamic, CoverageGapsPage(), dynamic, AnalyticsPage(), dynamic, POST(), runtime, POST() (+36 more)

### Community 1 - "Escalation Scanners & Markers"
Cohesion: 0.06
Nodes (47): FR-6.7, HUMAN_REQUEST_MARKERS, NEGATIVE_SENTIMENT_MARKERS, REACTION_MENTION_MARKERS, scanForHumanRequest(), scanForNegativeSentiment(), scanForReactionMention(), scanForSevereSymptoms() (+39 more)

### Community 2 - "Email Inbound Webhook"
Cohesion: 0.08
Nodes (28): emailProvider(), headersToRecord(), POST(), PostmarkInboundPayload, runtime, RFC-3676, EMAIL_CAPABILITIES, EmailChannelAdapter (+20 more)

### Community 3 - "Web Widget Chat UI"
Cohesion: 0.08
Nodes (29): CardRenderer(), OrderStatusCard(), TONE_CLASSES, ProductResultsCard(), RefusalCard(), ChatPanel(), PHASE_BANNER, SUGGESTIONS (+21 more)

### Community 4 - "Core Bootstrap & Test Fixtures"
Cohesion: 0.12
Nodes (18): buildCorePrompt(), buildRouterPrompt(), SessionContext, createDb(), moduleDir, schemaPath, TenantRepository, bool01() (+10 more)

### Community 5 - "Model Gateway Providers"
Cohesion: 0.11
Nodes (14): ScriptedProvider, ModelGateway, AnthropicProvider, DEFAULT_PRICING, estimateCostUsd(), mapError(), mapStopReason(), PRICING_PER_MILLION_USD (+6 more)

### Community 6 - "A/B Experiment Admin API"
Cohesion: 0.12
Nodes (20): runtime, runtime, POST(), runtime, POST(), runtime, POST(), runtime (+12 more)

### Community 7 - "TypeScript Project Config"
Cohesion: 0.06
Nodes (33): app/**/*.ts, app/**/*.tsx, components/**/*.ts, components/**/*.tsx, dom, dom.iterable, ES2022, .next/dev/types/**/*.ts (+25 more)

### Community 8 - "Migration Framework & History"
Cohesion: 0.16
Nodes (14): Migration, runMigrations(), migration001MessagesRebuildAndThreading, migration002RbacAndAudit, migration003ConversationsAssignee, migration004Tickets, migration005ToolApprovals, migration006Phase2Foundation (+6 more)

### Community 9 - "Model Alias Repository"
Cohesion: 0.12
Nodes (15): FallbackTarget, ModelAlias, ModelAliasRepository, ModelAliasRow, rowToModelAlias(), Attempt, ModelGatewayDeps, RETRYABLE (+7 more)

### Community 10 - "Eval Harness Runner"
Cohesion: 0.13
Nodes (19): main(), moduleDir, runCase(), THRESHOLD_DESCRIPTIONS, toFullResponse(), AssertionFailure, CaseResult, checkThresholds() (+11 more)

### Community 11 - "KB Ingest & Seed Scripts"
Cohesion: 0.16
Nodes (14): main(), scripts/seed.ts, getDb(), Tenant, OpenAiEmbeddingProvider, OpenAiEmbeddingResponse, StubEmbeddingProvider, EmbeddingProvider (+6 more)

### Community 12 - "Return Eligibility Tool"
Cohesion: 0.10
Nodes (23): ALTERNATIVE_ACTION_MAP, CheckReturnEligibilityInput, checkReturnEligibilityInputSchema, checkReturnEligibilityToolDef, CustomerRow, LineRow, OrderRow, ProductRow (+15 more)

### Community 13 - "Widget Chat API Route"
Cohesion: 0.13
Nodes (17): clientIp(), POST(), runtime, widgetAdapter, locks, withConversationLock(), appendToPath(), detectCycle() (+9 more)

### Community 14 - "Router & Agent Def Repository"
Cohesion: 0.14
Nodes (7): RouterResult, AgentDef, AgentDefRepository, AgentDefRow, hashToUnitInterval(), rowToAgentDef(), setup()

### Community 15 - "NPM Runtime Dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, bcryptjs, better-sqlite3, csv-parse, dotenv, next, nodemailer, dependencies (+13 more)

### Community 16 - "Lint & Dev Tooling Config"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, @types/bcryptjs, @types/better-sqlite3, @types/node (+13 more)

### Community 17 - "SLA Engine & Core Types"
Cohesion: 0.25
Nodes (9): computeDueAt(), startSlaClock(), ConversationChannel, ConversationPriority, ConversationRow, rowToPolicy(), SlaPolicy, SlaPolicyRepository (+1 more)

### Community 18 - "CI Pipeline Workflow"
Cohesion: 0.12
Nodes (19): FR-12.3 (LLM-as-judge subset, not built), FR-12.4 (deterministic regression gate), CI Workflow, npm run eval (CI step, golden-dataset gate), npm run lint (CI step), npm test (CI step), npm run typecheck (CI step), FR-12.1 (+11 more)

### Community 19 - "Cancel Order Write Tool"
Cohesion: 0.18
Nodes (13): ToolDefinition, CancelOrderInput, cancelOrderInputSchema, cancelOrderToolDef, runCancelOrder(), canonicalize(), computeIdempotencyKey(), executeTool() (+5 more)

### Community 20 - "Amarelle Formatting Helpers"
Cohesion: 0.17
Nodes (16): formatDayMonth(), formatWeekday(), MONTHS, STATUS_LABELS, statusLabel(), WEEKDAYS, buildOrderResult(), buildSteps() (+8 more)

### Community 21 - "Conversation Repository & Email Channel"
Cohesion: 0.20
Nodes (9): app/api/channels/email/inbound/route.ts, NFR-9.2 (one interface promise), Phase 1b M2: Email/Ticketing Channel, src/channel/, src/channel/email/ (threading, quoted-reply stripping, autoresponder guard, ticket lifecycle), processInboundTurn(), Conversation, ConversationRepository (+1 more)

### Community 22 - "Macro & Review Queue Repositories"
Cohesion: 0.16
Nodes (10): Macro, MacroRow, ReviewQueueEntry, ReviewQueueRow, ReviewQueueStatus, Run, RunRow, SemanticCacheEntry (+2 more)

### Community 23 - "Conversation Messages API"
Cohesion: 0.19
Nodes (9): GET(), runtime, CanonicalMessage, MessageRole, MessageVisibility, MessageRepository, MessageRow, MessageThreadRow (+1 more)

### Community 24 - "Tool Approval Workflow"
Cohesion: 0.21
Nodes (9): POST(), runtime, rowToApproval(), ToolApproval, ToolApprovalRepository, ToolApprovalRow, ToolApprovalStatus, ApprovalPolicy (+1 more)

### Community 25 - "Tool Call Repository"
Cohesion: 0.15
Nodes (8): rowToToolCall(), rowToToolDef(), ToolCallRecord, ToolCallRepository, ToolCallRow, ToolDef, ToolDefRepository, ToolDefRow

### Community 26 - "Conversation Replay Timeline"
Cohesion: 0.20
Nodes (10): describeEvent(), dynamic, ReplayPage(), ReplayItem, ReplayTimeline(), ConversationEvent, ConversationEventType, EventRepository (+2 more)

### Community 27 - "Write Tool Approval Docs"
Cohesion: 0.15
Nodes (14): app/api/desk/[conversationId]/approvals/[approvalId]/route.ts, create_return tool (does not exist yet), Invariant: Write Tools Require Approval Policy Gate, tool_calls.idempotency_key field, tool_defs.approval_policy field, Pending approvals panel (desk UI), Phase 1b M3: Write Tools + Approval Policy, Phase 1b Completion Summary (+6 more)

### Community 28 - "Amarelle KB Articles"
Cohesion: 0.15
Nodes (14): About Amarelle Botanique, Choosing the Right Product, Refills (AB-RF Reference), General Questions FAQ, Ingredient and Allergen Questions, Product Safety and Ingredients, Returns and Refunds Policy, Sealed vs Opened Products — Hygiene Requirement (+6 more)

### Community 29 - "KB Chunking & Ingestion"
Cohesion: 0.27
Nodes (9): chunkMarkdown(), estimateTokenCount(), RawChunk, ingestKnowledgeBase(), KNOWLEDGE_DIR, loadKnowledgeDocs(), ParsedDoc, parseFrontMatter() (+1 more)

### Community 30 - "Desk API & Cost Tracking Docs"
Cohesion: 0.17
Nodes (12): app/api/desk/ handlers, app/desk/ human desk UI, FR-11.6, FR-13.2, FR-9.6, Phase 1b M1: Migrations + Staff RBAC, Per-turn trace panel, users/sessions/audit_log tables (+4 more)

### Community 31 - "Macros API & Repository"
Cohesion: 0.26
Nodes (5): DELETE(), PATCH(), GET(), MacroRepository, rowToMacro()

### Community 32 - "Desk List Page & Clock"
Cohesion: 0.26
Nodes (8): CHANNEL_FILTERS, DeskPage(), dynamic, slaBadge(), now(), StaffCandidate, suggestAssignees(), SuggestedAssignee

### Community 33 - "Agent Handoff Path & Loop Prevention"
Cohesion: 0.17
Nodes (12): Agent-path breadcrumb + handoff context UI, conversations.metadata.agentPath, Copilot-draft hardcoded support-generalist bug fix, FR-6.1, FR-6.6, FR-6.8, FR-9.3, handoffTargets column (+4 more)

### Community 34 - "KB Article & Chunk Repository"
Cohesion: 0.20
Nodes (6): KbArticle, KbArticleRow, KbChunk, KbChunkRepository, KbChunkRow, rowToChunk()

### Community 35 - "Repo Rules & Requirements Docs"
Cohesion: 0.24
Nodes (11): Amarelle Botanique (Tenant), Before Committing Checklist, Invariant: Amarelle Botanique Is Tenant Data, Not Platform Code, CX Platform Repo Rules (CLAUDE.md), docs/00-requirements.md, FR-5.12, Phase 0 (foundation), Phase 1 (six-week cut) (+3 more)

### Community 36 - "Cost Analytics & Ticket Repo"
Cohesion: 0.18
Nodes (7): ConversationCostSummary, getConversationCostSummaries(), Ticket, TicketPriority, TicketRow, TicketStatus, TenantContext

### Community 37 - "Agent Experiment Repository"
Cohesion: 0.22
Nodes (5): AgentExperiment, AgentExperimentRepository, AgentExperimentRow, AgentExperimentStatus, rowToExperiment()

### Community 38 - "Amarelle Business Repo Methods"
Cohesion: 0.27
Nodes (3): runCheckReturnEligibility(), runLookupOrder(), AmarelleRepo

### Community 39 - "NPM Package Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, eval, ingest-kb, lint, seed, start (+2 more)

### Community 40 - "KB Coverage-Gap Reporting"
Cohesion: 0.24
Nodes (5): CoverageGap, KbRetrievalLogEntry, KbRetrievalLogRepository, KbRetrievalLogRow, rowToEntry()

### Community 41 - "Search Products Tool"
Cohesion: 0.22
Nodes (8): money(), CONCERNS, PRODUCT_LINES, runSearchProducts(), SearchProductsInput, searchProductsInputSchema, searchProductsToolDef, SKIN_PROFILES

### Community 42 - "Desk Conversation Detail Page"
Cohesion: 0.28
Nodes (5): dynamic, ApprovalsPanel(), PendingApproval, DeskComposer(), Macro

### Community 43 - "Session Repository"
Cohesion: 0.25
Nodes (4): rowToSession(), Session, SessionRepository, SessionRow

### Community 44 - "Review Queue API"
Cohesion: 0.32
Nodes (3): PATCH(), ReviewQueueRepository, rowToEntry()

### Community 45 - "Guardrail Policy Docs"
Cohesion: 0.25
Nodes (8): agent_defs.guardrails column, blockingMode (opt-in per agent), Forbidden-claims marker list, FR-7.13, Output groundedness check, Phase 1b M4: Guardrail Suite, PII-leakage heuristic, src/guardrails/

### Community 46 - "Audit Log Repository"
Cohesion: 0.29
Nodes (4): AuditLogEntry, AuditLogRepository, AuditLogRow, rowToEntry()

### Community 47 - "LLM Call Repository"
Cohesion: 0.29
Nodes (4): LlmCallRecord, LlmCallRepository, LlmCallRow, rowToRecord()

### Community 48 - "Hybrid Retrieval Docs"
Cohesion: 0.29
Nodes (7): FR-7.4, FR-7.6, FR-7.7, kb_scope audience filtering, Reciprocal Rank Fusion, SQLite FTS5 (porter-stemmed), src/kb/ hybrid retrieval

### Community 49 - "Tool Registry & Handlers"
Cohesion: 0.33
Nodes (6): FR-8.10, FR-8.9, src/tools/amarelle/check-return-eligibility.ts, src/tools/amarelle/lookup-order.ts, src/tools/amarelle/search-products.ts, src/tools/ tool registry

### Community 51 - "SSE Streaming Docs"
Cohesion: 0.40
Nodes (5): app/api/chat/route.ts, components/chat/ web widget, handoff event + polling fallback, NFR-6.2 (AI disclosure), SSE streaming

### Community 52 - "Demo Date & Handoff Fixture"
Cohesion: 0.40
Nodes (5): amarelle-handoff ORD-100001 case, DEMO_DATE env var, Invariant: Inject Clock via today(), Never new Date(), amarelle-handoff (external demo repo), tests/tools.test.ts REACTION-window case

### Community 53 - "Gateway Boundary Invariant"
Cohesion: 0.40
Nodes (5): Invariant: No Provider SDK Crosses Gateway Boundary, eslint.config.mjs no-restricted-imports rule, NFR-1.1, src/gateway/ chatStream(), src/gateway/providers/*.ts adapters

### Community 54 - "Skin Reaction Escalation Rule"
Cohesion: 0.60
Nodes (5): Company Values — Plant-First, Transparency, Reaction-as-Safety, Reporting a Skin Reaction (Product Safety Case), Skin Reaction Return Exception (90 Days, Any Opened State), Skin Reactions Rule, Internal Escalation Guide (Fixture)

### Community 55 - "Package Metadata"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 56 - "Model Capability Matrix"
Cohesion: 0.50
Nodes (3): CAPABILITY_MATRIX, getCapabilities(), ModelCapabilities

### Community 63 - "Tenant Scoping Invariant"
Cohesion: 0.50
Nodes (4): Invariant: TenantScopedRepository Pattern, TenantContext, TenantRepository, TenantScopedRepository

### Community 64 - "Escalation Triggers Doc"
Cohesion: 0.50
Nodes (4): Deterministic escalation triggers, FR-6.12, FR-6.2, src/agents/ agent runtime

### Community 67 - "In-Memory Session Store"
Cohesion: 0.67
Nodes (3): Invariant: In-Memory Session Store Is a Known Simplification, NFR-3.1 (multi-instance deploy), src/agents/sessions-store.ts (in-memory session store)

### Community 68 - "Model Alias Invariant"
Cohesion: 0.67
Nodes (3): Invariant: Model Bindings Are Per-Tenant Aliases, model_aliases table, tests/gateway-swap.test.ts

## Knowledge Gaps
- **360 isolated node(s):** `SessionContext`, `FallbackTarget`, `ModelAliasRow`, `OpenAiEmbeddingResponse`, `Attempt` (+355 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **67 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `executeTool()` connect `Cancel Order Write Tool` to `Escalation Scanners & Markers`, `Core Bootstrap & Test Fixtures`, `Tool Registry & Handlers`, `Tool Approval Workflow`, `Tool Call Repository`, `Write Tool Approval Docs`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `CX Platform README Overview` connect `Repo Rules & Requirements Docs` to `Escalation Triggers Doc`, `Hybrid Retrieval Docs`, `Tool Registry & Handlers`, `SSE Streaming Docs`, `Demo Date & Handoff Fixture`, `Gateway Boundary Invariant`, `Write Tool Approval Docs`, `Desk API & Cost Tracking Docs`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `src/tools/ tool registry` connect `Tool Registry & Handlers` to `Cancel Order Write Tool`, `Repo Rules & Requirements Docs`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `SessionContext`, `FallbackTarget`, `ModelAliasRow` to the rest of the system?**
  _360 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Staff Auth & Analytics Surfaces` be split into smaller, more focused modules?**
  _Cohesion score 0.05370843989769821 - nodes in this community are weakly interconnected._
- **Should `Escalation Scanners & Markers` be split into smaller, more focused modules?**
  _Cohesion score 0.06229508196721312 - nodes in this community are weakly interconnected._
- **Should `Email Inbound Webhook` be split into smaller, more focused modules?**
  _Cohesion score 0.08208020050125313 - nodes in this community are weakly interconnected._