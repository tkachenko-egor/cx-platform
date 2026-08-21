import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface FallbackTarget {
  provider: string;
  model: string;
}

export interface ModelAlias {
  id: string;
  tenantId: string;
  alias: string;
  provider: string;
  model: string;
  fallbackChain: FallbackTarget[];
}

interface ModelAliasRow {
  id: string;
  tenant_id: string;
  alias: string;
  provider: string;
  model: string;
  fallback_chain: string;
}

function rowToModelAlias(row: ModelAliasRow): ModelAlias {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    alias: row.alias,
    provider: row.provider,
    model: row.model,
    fallbackChain: JSON.parse(row.fallback_chain) as FallbackTarget[],
  };
}

/**
 * FR-5.6: swapping the underlying model behind an alias is a single
 * upsert() call — this is the mechanism the Phase 0 exit criterion tests.
 */
export class ModelAliasRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  upsert(input: {
    alias: string;
    provider: string;
    model: string;
    fallbackChain?: FallbackTarget[];
  }): ModelAlias {
    const fallbackChain = input.fallbackChain ?? [];
    const now = new Date().toISOString();
    const existing = this.getByAlias(input.alias);

    if (existing) {
      this.db
        .prepare(
          `UPDATE model_aliases SET provider = ?, model = ?, fallback_chain = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(input.provider, input.model, JSON.stringify(fallbackChain), now, existing.id, this.tenantId);
      return { ...existing, provider: input.provider, model: input.model, fallbackChain };
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO model_aliases (id, tenant_id, alias, provider, model, fallback_chain, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.alias, input.provider, input.model, JSON.stringify(fallbackChain), now, now);
    return { id, tenantId: this.tenantId, alias: input.alias, provider: input.provider, model: input.model, fallbackChain };
  }

  getByAlias(alias: string): ModelAlias | undefined {
    const row = this.db
      .prepare(
        `SELECT id, tenant_id, alias, provider, model, fallback_chain FROM model_aliases
         WHERE tenant_id = ? AND alias = ?`,
      )
      .get(this.tenantId, alias) as ModelAliasRow | undefined;
    return row ? rowToModelAlias(row) : undefined;
  }
}
