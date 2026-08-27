import type { Migration } from "../migrate";

/**
 * B1: the SQLite `schema.sql` + all 30 incremental migrations, squashed into a
 * single Postgres baseline. There was no production database to preserve, so
 * history was collapsed rather than translated migration-by-migration.
 *
 * Type upgrades taken here (were all TEXT/INTEGER under SQLite):
 *   - JSON columns          → `jsonb`
 *   - platform timestamps   → `timestamptz`   (created_at, updated_at, *_at)
 *   - money / scores        → `double precision`
 *   - flags                 → `boolean`
 *   - kb_chunks keyword idx → `tsvector` + GIN  (was a standalone fts5 table)
 *
 * Deliberately left as `text`: commerce dates (order_date, ship_date, …,
 * expiry_date) and kb_articles.effective — eligibility logic compares these as
 * strings against `src/core/clock.ts`'s `today()` (invariant #6).
 * `kb_chunks.embedding` stays `jsonb` until B2 swaps it for `vector(N)`.
 */
const SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'UTC',
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS model_aliases (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  alias text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  fallback_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, alias)
);
CREATE INDEX IF NOT EXISTS idx_model_aliases_tenant ON model_aliases(tenant_id);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','supervisor','agent','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS agent_defs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  system_prompt text NOT NULL,
  model_alias text NOT NULL,
  tool_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  kb_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  handoff_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  semantic_cache_enabled boolean NOT NULL DEFAULT false,
  native_tools jsonb NOT NULL DEFAULT '{}'::jsonb,
  quick_replies jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  internal_description text NOT NULL DEFAULT '',
  owner_user_id text REFERENCES users(id),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_status text NOT NULL DEFAULT 'active' CHECK (agent_status IN ('draft','active','paused','archived')),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  change_notes text NOT NULL DEFAULT '',
  temperature double precision,
  max_output_tokens integer,
  cost_ceiling_usd double precision,
  persona jsonb NOT NULL DEFAULT '{}'::jsonb,
  language_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_hours jsonb,
  tool_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, key, version)
);
CREATE INDEX IF NOT EXISTS idx_agent_defs_tenant ON agent_defs(tenant_id);

CREATE TABLE IF NOT EXISTS llm_calls (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  run_id text NOT NULL,
  model_alias text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  cached_tokens integer NOT NULL,
  cost_usd double precision NOT NULL,
  latency_ms integer NOT NULL,
  fallback_used boolean NOT NULL,
  error_type text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_tenant ON llm_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_run ON llm_calls(run_id);

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  channel text NOT NULL,
  state text NOT NULL CHECK (state IN ('bot_active','awaiting_human','human_active','snoozed','resolved','closed')),
  current_agent_key text,
  assignee_id text REFERENCES users(id),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  sla_due_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_state ON conversations(tenant_id, state);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL REFERENCES conversations(id),
  role text NOT NULL CHECK (role IN ('user','assistant','agent_human','system','tool_call','tool_result','handoff','note')),
  content text NOT NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  sequence integer NOT NULL,
  channel_message_id text,
  in_reply_to text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sequence);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL REFERENCES conversations(id),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL REFERENCES conversations(id),
  agent_key text NOT NULL,
  agent_version integer NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant_id);

CREATE TABLE IF NOT EXISTS kb_collections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  openai_vector_store_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_collections_tenant ON kb_collections(tenant_id);

CREATE TABLE IF NOT EXISTS kb_articles (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  doc_id text NOT NULL,
  title text NOT NULL,
  audience text NOT NULL DEFAULT 'customer',
  effective text,
  content_hash text NOT NULL,
  body text NOT NULL DEFAULT '',
  collection_id text REFERENCES kb_collections(id),
  openai_file_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant ON kb_articles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_collection ON kb_articles(collection_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  article_id text NOT NULL REFERENCES kb_articles(id),
  ordinal integer NOT NULL,
  heading text,
  text text NOT NULL,
  embedding jsonb NOT NULL,
  embedding_model text NOT NULL,
  token_count integer NOT NULL,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant ON kb_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_article ON kb_chunks(article_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_fts ON kb_chunks USING gin(fts);

CREATE TABLE IF NOT EXISTS kb_retrieval_log (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL,
  run_id text NOT NULL,
  query_text text NOT NULL,
  best_score double precision NOT NULL,
  retrieved_doc_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reranked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_retrieval_log_tenant ON kb_retrieval_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_retrieval_log_tenant_score ON kb_retrieval_log(tenant_id, best_score);

CREATE TABLE IF NOT EXISTS semantic_cache (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  agent_key text NOT NULL,
  query_text text NOT NULL,
  query_embedding jsonb NOT NULL,
  response_text text NOT NULL,
  citable_docs jsonb NOT NULL DEFAULT '[]'::jsonb,
  hit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  last_hit_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_tenant_agent ON semantic_cache(tenant_id, agent_key);

CREATE TABLE IF NOT EXISTS tool_defs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  description text NOT NULL,
  input_schema jsonb NOT NULL,
  write_flag boolean NOT NULL DEFAULT false,
  approval_policy text NOT NULL DEFAULT 'auto' CHECK (approval_policy IN ('auto','confirm_with_customer','require_human_approval')),
  type text NOT NULL DEFAULT 'code' CHECK (type IN ('code','http')),
  handler_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_tool_defs_tenant ON tool_defs(tenant_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  run_id text NOT NULL,
  tool_key text NOT NULL,
  arguments jsonb NOT NULL,
  result jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','error')),
  latency_ms integer NOT NULL,
  idempotency_key text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tenant ON tool_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_idempotency ON tool_calls(tenant_id, tool_key, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tool_approvals (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  run_id text NOT NULL,
  conversation_id text NOT NULL,
  tool_key text NOT NULL,
  arguments jsonb NOT NULL,
  idempotency_key text NOT NULL,
  policy text NOT NULL CHECK (policy IN ('confirm_with_customer','require_human_approval')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_by text REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_tool_approvals_tenant ON tool_approvals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_approvals_conversation ON tool_approvals(conversation_id);

CREATE TABLE IF NOT EXISTS agent_publish_approvals (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  agent_key text NOT NULL,
  requested_version integer NOT NULL,
  requested_by text NOT NULL REFERENCES users(id),
  payload jsonb NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  from_environment text NOT NULL,
  to_environment text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by text REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_publish_approvals_tenant ON agent_publish_approvals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_publish_approvals_tenant_status ON agent_publish_approvals(tenant_id, status);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);

CREATE TABLE IF NOT EXISTS user_invites (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','supervisor','agent','viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by text REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_invites_tenant ON user_invites(tenant_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_tenant ON password_reset_tokens(tenant_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  actor_user_id text REFERENCES users(id),
  action text NOT NULL,
  target text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);

CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL REFERENCES conversations(id),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','pending_customer','pending_internal','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  category text,
  assignee_id text REFERENCES users(id),
  due_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets(tenant_id, status);

CREATE TABLE IF NOT EXISTS sla_policies (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  priority text NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  target_minutes integer NOT NULL,
  applies_to_channel text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant ON sla_policies(tenant_id);

CREATE TABLE IF NOT EXISTS review_queue (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL,
  reason text NOT NULL,
  source_event_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
  reviewed_by text REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_queue_tenant ON review_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_tenant_status ON review_queue(tenant_id, status);

CREATE TABLE IF NOT EXISTS agent_experiments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  agent_key text NOT NULL,
  variant_a_version integer NOT NULL,
  variant_b_version integer NOT NULL,
  traffic_split double precision NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_experiments_tenant ON agent_experiments(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_experiments_one_active ON agent_experiments(tenant_id, agent_key) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS customers (
  tenant_id text NOT NULL REFERENCES tenants(id),
  customer_id text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  loyalty_tier text NOT NULL,
  loyalty_points integer NOT NULL,
  country text,
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(tenant_id, email);

CREATE TABLE IF NOT EXISTS orders (
  tenant_id text NOT NULL REFERENCES tenants(id),
  order_id text NOT NULL,
  customer_id text NOT NULL,
  order_date text NOT NULL,
  status text NOT NULL,
  ship_date text,
  delivered_date text,
  eta_date text,
  carrier text,
  tracking_number text,
  shipping_method text,
  subtotal_amount double precision NOT NULL,
  shipping_amount double precision NOT NULL,
  tax_amount double precision NOT NULL,
  total_amount double precision NOT NULL,
  shipping_address text,
  PRIMARY KEY (tenant_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS order_lines (
  tenant_id text NOT NULL REFERENCES tenants(id),
  line_id text NOT NULL,
  order_id text NOT NULL,
  product_id text NOT NULL,
  sku text NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL,
  unit_price double precision NOT NULL,
  line_total double precision NOT NULL,
  batch_number text,
  expiry_date text,
  is_opened text NOT NULL CHECK (is_opened IN ('Yes','No','Unknown')),
  PRIMARY KEY (tenant_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(tenant_id, order_id);

CREATE TABLE IF NOT EXISTS products (
  tenant_id text NOT NULL REFERENCES tenants(id),
  product_id text NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  category text,
  tags text,
  price double precision NOT NULL,
  stock_qty integer NOT NULL,
  is_promotional_item boolean NOT NULL DEFAULT false,
  rating double precision,
  short_description text,
  image_url text,
  PRIMARY KEY (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);

CREATE TABLE IF NOT EXISTS macros (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  body text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_macros_tenant ON macros(tenant_id);

CREATE TABLE IF NOT EXISTS provider_credentials (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('llm_provider','tool_integration')),
  provider text NOT NULL,
  label text NOT NULL,
  encrypted_key text NOT NULL,
  key_last4 text NOT NULL,
  owner_user_id text NOT NULL REFERENCES users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  rotated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_tenant ON provider_credentials(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_credentials_one_active_llm
  ON provider_credentials(tenant_id, provider) WHERE kind = 'llm_provider' AND is_active = true;

CREATE TABLE IF NOT EXISTS widget_configs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  agent_key text NOT NULL,
  public_key text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT 'Support',
  greeting_text text NOT NULL DEFAULT '',
  primary_color text NOT NULL DEFAULT '#3454d1',
  logo_url text,
  position text NOT NULL DEFAULT 'bottom-right',
  font_family text NOT NULL DEFAULT 'inter',
  user_bubble_color text NOT NULL DEFAULT '#13141a',
  bot_bubble_color text NOT NULL DEFAULT '#f1f2f6',
  audience_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, agent_key)
);
CREATE INDEX IF NOT EXISTS idx_widget_configs_public_key ON widget_configs(public_key);

CREATE TABLE IF NOT EXISTS message_feedback (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL,
  message_id text NOT NULL,
  rating text NOT NULL CHECK (rating IN ('up','down')),
  comment text,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_message_feedback_tenant ON message_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_conversation ON message_feedback(conversation_id);

CREATE TABLE IF NOT EXISTS auto_tag_rules (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  tag text NOT NULL,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_tenant ON auto_tag_rules(tenant_id);
`;

export const migration000Baseline: Migration = {
  id: "000-baseline",
  async up(db) {
    await db.exec(SQL);
  },
};
