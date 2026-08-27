import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { ConversationChannel, ConversationPriority } from "../../core/types";

export interface SlaPolicy {
  id: string;
  tenantId: string;
  priority: ConversationPriority;
  targetMinutes: number;
  appliesToChannel: ConversationChannel | null;
  createdAt: string;
}

interface SlaPolicyRow {
  id: string;
  tenant_id: string;
  priority: ConversationPriority;
  target_minutes: number;
  applies_to_channel: ConversationChannel | null;
  created_at: string;
}

function rowToPolicy(row: SlaPolicyRow): SlaPolicy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    priority: row.priority,
    targetMinutes: row.target_minutes,
    appliesToChannel: row.applies_to_channel,
    createdAt: row.created_at,
  };
}

/** Phase 2 M4: naive elapsed-time SLA policies — see src/core/sla.ts for the due-at math built on top of this. */
export class SlaPolicyRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: { priority: ConversationPriority; targetMinutes: number; appliesToChannel?: ConversationChannel }): Promise<SlaPolicy> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO sla_policies (id, tenant_id, priority, target_minutes, applies_to_channel, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, this.tenantId, input.priority, input.targetMinutes, input.appliesToChannel ?? null, now);
    return { id, tenantId: this.tenantId, priority: input.priority, targetMinutes: input.targetMinutes, appliesToChannel: input.appliesToChannel ?? null, createdAt: now };
  }

  async list(): Promise<SlaPolicy[]> {
    const rows = this.db.prepare(`SELECT * FROM sla_policies WHERE tenant_id = ?`).all(this.tenantId) as SlaPolicyRow[];
    return rows.map(rowToPolicy);
  }

  /** Channel-specific policy takes precedence over a channel-agnostic (applies_to_channel IS NULL) one for the same priority. */
  async findForPriorityAndChannel(priority: ConversationPriority, channel: ConversationChannel): Promise<SlaPolicy | undefined> {
    const specific = this.db
      .prepare(`SELECT * FROM sla_policies WHERE tenant_id = ? AND priority = ? AND applies_to_channel = ?`)
      .get(this.tenantId, priority, channel) as SlaPolicyRow | undefined;
    if (specific) return rowToPolicy(specific);

    const generic = this.db
      .prepare(`SELECT * FROM sla_policies WHERE tenant_id = ? AND priority = ? AND applies_to_channel IS NULL`)
      .get(this.tenantId, priority) as SlaPolicyRow | undefined;
    return generic ? rowToPolicy(generic) : undefined;
  }
}
