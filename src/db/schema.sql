-- Phase 0 subset of the data model sketch. Every table but `tenants` itself
-- carries tenant_id and is only ever written/read through a
-- TenantScopedRepository subclass.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
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
  role TEXT NOT NULL CHECK (role IN ('user','assistant','agent_human','system','note')),
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  sequence INTEGER NOT NULL,
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
CREATE TABLE IF NOT EXISTS kb_articles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'customer',
  effective TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant ON kb_articles(tenant_id);

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
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tenant ON tool_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id);

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
