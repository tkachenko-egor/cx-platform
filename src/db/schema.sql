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
