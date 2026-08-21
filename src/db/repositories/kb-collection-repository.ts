import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface KbCollection {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  /** Phase 6 M3: set once File Search is first enabled for an agent using this collection — see src/kb/openai-vector-store-sync.ts. */
  openaiVectorStoreId: string | null;
}

interface KbCollectionRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  openai_vector_store_id: string | null;
}

function rowToCollection(row: KbCollectionRow): KbCollection {
  return { id: row.id, tenantId: row.tenant_id, name: row.name, description: row.description, openaiVectorStoreId: row.openai_vector_store_id };
}

/** Phase 5 M1: named, reusable Knowledge Base collections an agent picks from (agent_defs.kb_scope.collectionIds) — see migration 018 for the backfill of pre-existing articles into a "General" collection. */
export class KbCollectionRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  create(input: { name: string; description?: string }): KbCollection {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO kb_collections (id, tenant_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, this.tenantId, input.name, input.description ?? "", now, now);
    return { id, tenantId: this.tenantId, name: input.name, description: input.description ?? "", openaiVectorStoreId: null };
  }

  getById(id: string): KbCollection | undefined {
    const row = this.db.prepare(`SELECT * FROM kb_collections WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as KbCollectionRow | undefined;
    return row ? rowToCollection(row) : undefined;
  }

  list(): KbCollection[] {
    const rows = this.db.prepare(`SELECT * FROM kb_collections WHERE tenant_id = ? ORDER BY name`).all(this.tenantId) as KbCollectionRow[];
    return rows.map(rowToCollection);
  }

  countArticles(id: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) as n FROM kb_articles WHERE tenant_id = ? AND collection_id = ?`).get(this.tenantId, id) as { n: number };
    return row.n;
  }

  /** Blocked if non-empty — no cascade/reassign UI this round, simplest safe rule. */
  delete(id: string): { ok: true } | { ok: false; error: string } {
    if (this.countArticles(id) > 0) return { ok: false, error: "Move or delete its articles first" };
    this.db.prepare(`DELETE FROM kb_collections WHERE tenant_id = ? AND id = ?`).run(this.tenantId, id);
    return { ok: true };
  }

  /** Phase 6 M3: called once by ensureVectorStore() after provisioning — never overwrites an already-set id. */
  setOpenAiVectorStoreId(id: string, vectorStoreId: string): void {
    this.db.prepare(`UPDATE kb_collections SET openai_vector_store_id = ? WHERE tenant_id = ? AND id = ?`).run(vectorStoreId, this.tenantId, id);
  }

  /** Covers fresh installs: migration 018's backfill only catches articles that existed at migration time, so scripts/ingest-kb.ts (run after seeding on an empty DB) needs somewhere to put new file-sourced articles too. */
  ensureDefault(): KbCollection {
    const row = this.db.prepare(`SELECT * FROM kb_collections WHERE tenant_id = ? AND name = 'General' ORDER BY created_at ASC LIMIT 1`).get(this.tenantId) as KbCollectionRow | undefined;
    if (row) return rowToCollection(row);
    return this.create({ name: "General", description: "Default collection for articles that existed before Knowledge Bases were introduced." });
  }
}
