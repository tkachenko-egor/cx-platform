import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface Macro {
  id: string;
  tenantId: string;
  name: string;
  body: string;
  tags: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MacroRow {
  id: string;
  tenant_id: string;
  name: string;
  body: string;
  tags: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMacro(row: MacroRow): Macro {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    body: row.body,
    tags: JSON.parse(row.tags) as string[],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Phase 2 M8: canned-response text for the desk composer — pure text-insertion, no macro "actions". */
export class MacroRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  create(input: { name: string; body: string; tags?: string[]; createdBy?: string }): Macro {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO macros (id, tenant_id, name, body, tags, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.name, input.body, JSON.stringify(input.tags ?? []), input.createdBy ?? null, now, now);
    return this.get(id)!;
  }

  get(id: string): Macro | undefined {
    const row = this.db.prepare(`SELECT * FROM macros WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as MacroRow | undefined;
    return row ? rowToMacro(row) : undefined;
  }

  list(): Macro[] {
    const rows = this.db.prepare(`SELECT * FROM macros WHERE tenant_id = ? ORDER BY name ASC`).all(this.tenantId) as MacroRow[];
    return rows.map(rowToMacro);
  }

  /** Substring match over name/body — the picker's typeahead filter, small enough at this scale for a LIKE scan. */
  search(query: string): Macro[] {
    const needle = `%${query}%`;
    const rows = this.db
      .prepare(`SELECT * FROM macros WHERE tenant_id = ? AND (name LIKE ? OR body LIKE ?) ORDER BY name ASC`)
      .all(this.tenantId, needle, needle) as MacroRow[];
    return rows.map(rowToMacro);
  }

  update(id: string, patch: { name?: string; body?: string; tags?: string[] }): void {
    const current = this.get(id);
    if (!current) return;
    this.db
      .prepare(`UPDATE macros SET name = ?, body = ?, tags = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(patch.name ?? current.name, patch.body ?? current.body, JSON.stringify(patch.tags ?? current.tags), new Date().toISOString(), this.tenantId, id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM macros WHERE tenant_id = ? AND id = ?`).run(this.tenantId, id);
  }
}
