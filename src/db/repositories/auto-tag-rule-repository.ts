import { randomUUID } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface AutoTagRule {
  id: string;
  tenantId: string;
  tag: string;
  keywords: string[];
  createdAt: string;
}

interface AutoTagRuleRow {
  id: string;
  tenant_id: string;
  tag: string;
  keywords: string;
  created_at: string;
}

function rowToRule(row: AutoTagRuleRow): AutoTagRule {
  return { id: row.id, tenantId: row.tenant_id, tag: row.tag, keywords: fromJson<string[]>(row.keywords), createdAt: row.created_at };
}

/** Phase 9 M4: keyword -> tag mappings for deterministic auto-tagging — see src/channel/turn.ts's scanAutoTags. Tenant-wide, not per-agent: a conversation can span multiple agents via handoff, and the tags are a "what was this about" signal independent of who answered. */
export class AutoTagRuleRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: { tag: string; keywords: string[] }): Promise<AutoTagRule> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO auto_tag_rules (id, tenant_id, tag, keywords, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, this.tenantId, input.tag, JSON.stringify(input.keywords), now);
    return { id, tenantId: this.tenantId, tag: input.tag, keywords: input.keywords, createdAt: now };
  }

  async list(): Promise<AutoTagRule[]> {
    const rows = await this.db.prepare(`SELECT * FROM auto_tag_rules WHERE tenant_id = ? ORDER BY created_at ASC`).all(this.tenantId) as AutoTagRuleRow[];
    return rows.map(rowToRule);
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM auto_tag_rules WHERE tenant_id = ? AND id = ?`).run(this.tenantId, id);
  }
}
