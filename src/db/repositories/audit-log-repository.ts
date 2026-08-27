import { randomUUID } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  action: string;
  target: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogRow {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  action: string;
  target: string;
  before: string | null;
  after: string | null;
  created_at: string;
}

function rowToEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    target: row.target,
    before: row.before ? (fromJson<Record<string, unknown>>(row.before)) : null,
    after: row.after ? (fromJson<Record<string, unknown>>(row.after)) : null,
    createdAt: row.created_at,
  };
}

/** FR-2.7: audit trail of privileged actions (config changes, PII access, tool-write approvals). */
export class AuditLogRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async record(entry: { actorUserId: string | null; action: string; target: string; before?: Record<string, unknown>; after?: Record<string, unknown> }): Promise<void> {
    await this.db
      .prepare(`INSERT INTO audit_log (id, tenant_id, actor_user_id, action, target, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        randomUUID(),
        this.tenantId,
        entry.actorUserId,
        entry.action,
        entry.target,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        new Date().toISOString(),
      );
  }

  async listByTarget(target: string): Promise<AuditLogEntry[]> {
    const rows = await this.db.prepare(`SELECT * FROM audit_log WHERE tenant_id = ? AND target = ? ORDER BY created_at ASC`).all(this.tenantId, target) as AuditLogRow[];
    return rows.map(rowToEntry);
  }

  /** Phase 3 M3: paginated viewer feed — newest first, optionally continuing from a `before` cursor (an earlier row's createdAt). */
  async listRecent(input?: { limit?: number; before?: string }): Promise<AuditLogEntry[]> {
    const limit = input?.limit ?? 50;
    const rows = input?.before
      ? (await this.db.prepare(`SELECT * FROM audit_log WHERE tenant_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`).all(this.tenantId, input.before, limit) as AuditLogRow[])
      : (await this.db.prepare(`SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`).all(this.tenantId, limit) as AuditLogRow[]);
    return rows.map(rowToEntry);
  }
}
