-- Phase 0 subset of the data model sketch. Every table but `tenants` itself
-- carries tenant_id and is only ever written/read through a
-- TenantScopedRepository subclass.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  -- Phase 9 (migration 024): weekly schedule + alert-threshold config, both
  -- tenant-wide (not per-agent) — see src/core/business-hours.ts and
  -- src/analytics/alerts.ts.
  business_hours TEXT NOT NULL DEFAULT '{}',
  alert_thresholds TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- FR-5.6: model references are logical aliases resolved through a
-- tenant-level mapping table. fallback_chain is JSON: [{provider, model}, ...]
CREATE TABLE IF NOT EXISTS model_aliases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  alias TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  fallback_chain TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_model_aliases_tenant ON model_aliases(tenant_id);

-- FR-6.1 / FR-6.3: agents are data, not code, and are versioned.
CREATE TABLE IF NOT EXISTS agent_defs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  system_prompt TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  tool_ids TEXT NOT NULL DEFAULT '[]',
  kb_scope TEXT NOT NULL DEFAULT '{}',
  handoff_targets TEXT NOT NULL DEFAULT '[]',
  guardrails TEXT NOT NULL DEFAULT '{}',
  skills TEXT NOT NULL DEFAULT '[]',
  semantic_cache_enabled INTEGER NOT NULL DEFAULT 0,
  native_tools TEXT NOT NULL DEFAULT '{}',
  quick_replies TEXT NOT NULL DEFAULT '[]',
  -- Phase 7 M1/M2/M3 (migration 022): admin-facing identity/lifecycle,
  -- remaining model controls, and persona/language config. Defaults keep
  -- every pre-existing row routable and write-enabled exactly as before —
  -- only the create-agent API route opts new agents into draft/sandbox.
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  internal_description TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT REFERENCES users(id),
  tags TEXT NOT NULL DEFAULT '[]',
  agent_status TEXT NOT NULL DEFAULT 'active' CHECK (agent_status IN ('draft','active','paused','archived')),
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  change_notes TEXT NOT NULL DEFAULT '',
  temperature REAL,
  max_output_tokens INTEGER,
  cost_ceiling_usd REAL,
  persona TEXT NOT NULL DEFAULT '{}',
  language_config TEXT NOT NULL DEFAULT '{}',
  -- Phase 8 M1 (migration 023): per-agent keyword/threshold overrides for
  -- the escalation scanners — appended to the hardcoded defaults in
  -- src/agents/escalation.ts, never replacing them.
  escalation_config TEXT NOT NULL DEFAULT '{}',
  -- Phase 9 (migration 024): structured conversation-logic config (topics/
  -- slots/memory-scope/variables, src/agents/system-prompt.ts's scopeBlock)
  -- and a per-agent channel allowlist (empty = all channels, src/channel/turn.ts).
  conversation_config TEXT NOT NULL DEFAULT '{}',
  enabled_channels TEXT NOT NULL DEFAULT '[]',
  -- Admin UI batch item 1 (migration 025): NULL = inherit tenants.business_hours,
  -- same BusinessHoursConfig JSON shape when set. See src/core/business-hours.ts.
  business_hours TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, key, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_defs_tenant ON agent_defs(tenant_id);

-- FR-5.10 / FR-13.1: usage accounting and basic tracing, one row per
-- provider call attempt (including failed attempts before a fallback).
CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  run_id TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  fallback_used INTEGER NOT NULL,
  error_type TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_tenant ON llm_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_run ON llm_calls(run_id);

-- ─── Phase 1 ────────────────────────────────────────────────────────────

-- FR-4: conversation core. Events are append-only; state lives on the
-- conversation row but every transition is also logged as an event
-- (FR-4.2) so history can be reconstructed by replay.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  channel TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('bot_active','awaiting_human','human_active','snoozed','resolved','closed')),
  current_agent_key TEXT,
  assignee_id TEXT REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  tags TEXT NOT NULL DEFAULT '[]',
  sla_due_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_state ON conversations(tenant_id, state);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant','agent_human','system','tool_call','tool_result','handoff','note')),
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  sequence INTEGER NOT NULL,
  channel_message_id TEXT,
  in_reply_to TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sequence);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id, created_at);

-- FR-6.3/data-model sketch: the unit that ties one turn to everything the
-- system did in response — almost every debugging/cost question joins
-- from here.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  agent_key TEXT NOT NULL,
  agent_version INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant_id);

-- FR-7: KB. kb_chunks.embedding is a JSON-encoded float array — fine at
-- this corpus size (NFR-3.4 headroom is 10x current, still tiny); a real
-- vector column is a later-phase concern, not a Phase-1 one.
-- Phase 5 M1: named, reusable Knowledge Base collections an agent picks
-- from (agent_defs.kb_scope.collectionIds) — see migration 018.
CREATE TABLE IF NOT EXISTS kb_collections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Phase 6 M3: lazily provisioned the first time an agent turns on OpenAI
  -- File Search against this collection (src/kb/openai-vector-store-sync.ts).
  openai_vector_store_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kb_collections_tenant ON kb_collections(tenant_id);

CREATE TABLE IF NOT EXISTS kb_articles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'customer',
  effective TEXT,
  content_hash TEXT NOT NULL,
  -- Phase 4 M3: admin-authored articles have no knowledge/*.md file, so the
  -- body has to live here. File-sourced articles leave this '' (their body
  -- lives on disk, read by scripts/ingest-kb.ts).
  body TEXT NOT NULL DEFAULT '',
  -- Phase 5 M1: which Knowledge Base this article belongs to.
  collection_id TEXT REFERENCES kb_collections(id),
  -- Phase 6 M3: set only when this article's collection has File Search
  -- enabled — the OpenAI file id it was uploaded as, for edit/delete sync.
  openai_file_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant ON kb_articles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_collection ON kb_articles(collection_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  article_id TEXT NOT NULL REFERENCES kb_articles(id),
  ordinal INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  token_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant ON kb_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_article ON kb_chunks(article_id);

-- Phase 2 coverage-gap reporting: every retrieval's fused RRF score gets
-- logged here, independent of whether the turn goes on to escalate — a
-- low-confidence retrieval the model "papers over" with a plausible-sounding
-- answer should still surface as a KB gap.
CREATE TABLE IF NOT EXISTS kb_retrieval_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  query_text TEXT NOT NULL,
  best_score REAL NOT NULL,
  retrieved_doc_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kb_retrieval_log_tenant ON kb_retrieval_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_retrieval_log_tenant_score ON kb_retrieval_log(tenant_id, best_score);

-- Phase 2 semantic caching (opt-in per agent via agent_defs.semantic_cache_enabled,
-- default off — see CLAUDE.md-adjacent trim note: caching a wrong answer looks
-- exactly like caching a right one, so this ships conservative). Same
-- JSON-array-embedding precedent as kb_chunks.embedding above.
CREATE TABLE IF NOT EXISTS semantic_cache (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agent_key TEXT NOT NULL,
  query_text TEXT NOT NULL,
  query_embedding TEXT NOT NULL,
  response_text TEXT NOT NULL,
  citable_docs TEXT NOT NULL DEFAULT '[]',
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_hit_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_tenant_agent ON semantic_cache(tenant_id, agent_key);

-- Standalone (non content=-linked) FTS5 table — kb_chunks uses a TEXT
-- primary key, not a rowid alias, so we index chunk_id as UNINDEXED and
-- maintain it manually on insert rather than via FTS5 content-sync triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  tenant_id UNINDEXED,
  text,
  tokenize = 'porter unicode61'
);

-- FR-8.1: tool registry metadata. Handlers themselves are code
-- (src/tools/**), keyed by `key`; this table carries the schema, write
-- flag and approval policy the runtime and admin surface read.
CREATE TABLE IF NOT EXISTS tool_defs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  write_flag INTEGER NOT NULL DEFAULT 0,
  approval_policy TEXT NOT NULL DEFAULT 'auto' CHECK (approval_policy IN ('auto','confirm_with_customer','require_human_approval')),
  -- Phase 3 M7: 'http' tools are admin-authored (no code handler) — their
  -- request config (url/method/auth/etc, see src/tools/http-tool-executor.ts)
  -- lives in handler_config. 'code' tools ignore handler_config; their
  -- handler is REGISTRY-defined in src/tools/registry.ts as before.
  type TEXT NOT NULL DEFAULT 'code' CHECK (type IN ('code','http')),
  handler_config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tool_defs_tenant ON tool_defs(tenant_id);

-- FR-8.10: execution log — the audit trail for any action taken on a
-- customer's behalf.
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  run_id TEXT NOT NULL,
  tool_key TEXT NOT NULL,
  arguments TEXT NOT NULL,
  result TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  latency_ms INTEGER NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tenant ON tool_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id);
-- FR-8.6: a retry never double-executes a write tool (partial index — only
-- non-null keys are constrained, so read-only tools are unaffected). Owned
-- by migration 005, not created here: on a pre-existing DB, schema.sql's
-- CREATE TABLE IF NOT EXISTS above is a no-op that leaves the old
-- (columnless) table in place, and this index's own IF NOT EXISTS only
-- guards the index name — it would still fail trying to reference a
-- column the migration hasn't added yet if it ran here.

-- FR-8.5: write tools with approval_policy != 'auto' park here instead of
-- executing immediately. confirm_with_customer is "approved" by the same
-- tool call being re-issued in a later turn (see src/tools/registry.ts);
-- require_human_approval is approved/denied via the desk API.
CREATE TABLE IF NOT EXISTS tool_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  tool_key TEXT NOT NULL,
  arguments TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN ('confirm_with_customer','require_human_approval')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_approvals_tenant ON tool_approvals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_approvals_conversation ON tool_approvals(conversation_id);

-- Phase 8 M3: same pending/decided shape as tool_approvals above, for a
-- different kind of write — a supervisor publishing an agent live (status=
-- active AND environment=production together) instead of a write tool.
-- payload is the full agent_defs.publish() input as JSON, replayed verbatim
-- by an admin/owner's approval rather than re-derived from the (possibly
-- since-changed) editor state.
CREATE TABLE IF NOT EXISTS agent_publish_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agent_key TEXT NOT NULL,
  requested_version INTEGER NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  payload TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  from_environment TEXT NOT NULL,
  to_environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_publish_approvals_tenant ON agent_publish_approvals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_publish_approvals_tenant_status ON agent_publish_approvals(tenant_id, status);

-- ─── Phase 1b: staff RBAC/auth ────────────────────────────────────────────
-- FR-2.1/2.2/2.7: staff identity, roles, sessions, and the audit trail for
-- privileged actions. End-customer identity (FR-2.3-2.6) is out of scope —
-- these tables are for the desk/admin side only.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','supervisor','agent','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  skills TEXT NOT NULL DEFAULT '[]',
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);

-- Phase 3 M2: staff invite + password-reset tokens.
CREATE TABLE IF NOT EXISTS user_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','supervisor','agent','viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_invites_tenant ON user_invites(tenant_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_tenant ON password_reset_tokens(tenant_id);

-- FR-2.7: audit log of privileged actions (config change, PII access,
-- conversation export, tool-write approvals).
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  before TEXT,
  after TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);

-- FR-3.17/3.18: ticket lifecycle for the email channel. One conversation
-- has at most one ticket — the conversation tracks who's engaged (bot vs
-- human), the ticket tracks support-ops resolution; deliberately separate
-- state machines.
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','pending_customer','pending_internal','resolved','closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  category TEXT,
  assignee_id TEXT REFERENCES users(id),
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets(tenant_id, status);

-- Phase 2 M4: SLA engine. Naive elapsed-time math (add target_minutes to
-- the timestamp a conversation entered awaiting_human) — full business-hours/
-- holiday calendars are a deliberate later-phase cut, same spirit as the
-- Phase 1 six-week cut's own trims. applies_to_channel NULL means "all
-- channels"; a channel-specific row (if present) takes precedence.
CREATE TABLE IF NOT EXISTS sla_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  target_minutes INTEGER NOT NULL,
  applies_to_channel TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant ON sla_policies(tenant_id);

-- Phase 2 M5: a review tier distinct from escalation — a conversation can
-- stay bot_active and still get queued here (e.g. a low-confidence KB
-- retrieval the model papered over with a plausible-sounding answer).
-- Mirrors tool_approvals' pending/decided shape; no FK on conversation_id,
-- same precedent as tool_approvals/kb_retrieval_log.
CREATE TABLE IF NOT EXISTS review_queue (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_queue_tenant ON review_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_tenant_status ON review_queue(tenant_id, status);

-- Phase 2 M6a: A/B testing of agent versions. Reuses agent_defs'
-- pre-existing versioning (publish() already inserts a new row per
-- version) rather than adding a new concept — this table just says "pick
-- variant B this often" for a key that otherwise resolves to
-- getLatestPublished(). traffic_split is the weight toward variant B
-- (0-1). At most one active experiment per (tenant, agent_key).
CREATE TABLE IF NOT EXISTS agent_experiments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agent_key TEXT NOT NULL,
  variant_a_version INTEGER NOT NULL,
  variant_b_version INTEGER NOT NULL,
  traffic_split REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_experiments_tenant ON agent_experiments(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_experiments_one_active ON agent_experiments(tenant_id, agent_key) WHERE status = 'active';

-- ─── Amarelle tenant business data (read-only for tools) ─────────────────
-- Ported from amarelle-handoff's CSVs. This is tenant DATA, not platform
-- code — see CLAUDE.md invariant #5. Only the tables the three read-only
-- tools need; returns/tickets/safety_cases are out of scope this phase.

CREATE TABLE IF NOT EXISTS customers (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  loyalty_tier TEXT NOT NULL,
  loyalty_points INTEGER NOT NULL,
  skin_profile TEXT,
  country TEXT,
  PRIMARY KEY (tenant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(tenant_id, email);

CREATE TABLE IF NOT EXISTS orders (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  order_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  status TEXT NOT NULL,
  ship_date TEXT,
  delivered_date TEXT,
  eta_date TEXT,
  carrier TEXT,
  tracking_number TEXT,
  shipping_method TEXT,
  subtotal_eur REAL NOT NULL,
  shipping_eur REAL NOT NULL,
  tax_eur REAL NOT NULL,
  total_eur REAL NOT NULL,
  shipping_address TEXT,
  PRIMARY KEY (tenant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS order_lines (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  line_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_eur REAL NOT NULL,
  line_total_eur REAL NOT NULL,
  batch_number TEXT,
  expiry_date TEXT,
  is_opened TEXT NOT NULL CHECK (is_opened IN ('Yes','No','Unknown')),
  PRIMARY KEY (tenant_id, line_id)
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(tenant_id, order_id);

CREATE TABLE IF NOT EXISTS products (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  product_line TEXT,
  form TEXT,
  key_botanical TEXT,
  concern TEXT,
  suitable_for TEXT,
  price_eur REAL NOT NULL,
  volume_ml INTEGER,
  pao_months INTEGER,
  stock_qty INTEGER NOT NULL,
  is_refillable INTEGER NOT NULL DEFAULT 0,
  refill_sku TEXT,
  is_gift_with_purchase INTEGER NOT NULL DEFAULT 0,
  shade TEXT,
  contains_essential_oils INTEGER NOT NULL DEFAULT 0,
  vegan INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  short_description TEXT,
  image_url TEXT,
  PRIMARY KEY (tenant_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);

-- Phase 2 M8: canned-response macros for the desk composer. Pure text-
-- insertion — no macro "actions" (auto-set ticket status/tag) since no
-- desk API route mutates ticket status yet; that's a separate follow-up.
CREATE TABLE IF NOT EXISTS macros (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_macros_tenant ON macros(tenant_id);

-- Phase 3 M7: DB-backed provider API keys, per-tenant, replacing the single
-- shared process env var. `kind` distinguishes LLM provider keys (one active
-- per tenant+provider, resolved by buildContext()) from HTTP-tool
-- integration credentials (many simultaneously active, addressed by id).
-- Each row is attributed to the staff user who added it for audit purposes.
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('llm_provider','tool_integration')),
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  rotated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_tenant ON provider_credentials(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_credentials_one_active_llm
  ON provider_credentials(tenant_id, provider) WHERE kind = 'llm_provider' AND is_active = 1;

-- Phase 4 M4: embeddable web widgets. NOT versioned with agent_defs — see
-- src/db/migrations/017-widget-configs.ts for why. public_key is a
-- separate minted id, never agent_defs.key (see src/platform/widget-context.ts).
CREATE TABLE IF NOT EXISTS widget_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agent_key TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Support',
  greeting_text TEXT NOT NULL DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '#3454d1',
  logo_url TEXT,
  position TEXT NOT NULL DEFAULT 'bottom-right',
  font_family TEXT NOT NULL DEFAULT 'inter',
  user_bubble_color TEXT NOT NULL DEFAULT '#13141a',
  bot_bubble_color TEXT NOT NULL DEFAULT '#f1f2f6',
  -- Phase 9 (migration 024): URL-pattern audience targeting — see
  -- app/api/embed-chat/[publicKey]/should-mount/route.ts.
  audience_rules TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, agent_key)
);

CREATE INDEX IF NOT EXISTS idx_widget_configs_public_key ON widget_configs(public_key);

-- Phase 9: thumbs up/down per bot message. One row per message (re-submitting
-- overwrites via upsert, see MessageFeedbackRepository) — see
-- app/api/chat/feedback/route.ts / app/api/embed-chat/[publicKey]/feedback/route.ts.
CREATE TABLE IF NOT EXISTS message_feedback (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('up','down')),
  comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_feedback_tenant ON message_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_conversation ON message_feedback(conversation_id);

-- Phase 9: keyword -> tag mappings for auto-tagging conversations (deterministic,
-- not an LLM classifier — see src/channel/turn.ts's scanAutoTags).
CREATE TABLE IF NOT EXISTS auto_tag_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tag TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_tenant ON auto_tag_rules(tenant_id);
