import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
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
    before: row.before ? (JSON.parse(row.before) as Record<string, unknown>) : null,
    after: row.after ? (JSON.parse(row.after) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

/** FR-2.7: audit trail of privileged actions (config changes, PII access, tool-write approvals). */
export class AuditLogRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  record(entry: { actorUserId: string | null; action: string; target: string; before?: Record<string, unknown>; after?: Record<string, unknown> }): void {
    this.db
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

  listByTarget(target: string): AuditLogEntry[] {
    const rows = this.db.prepare(`SELECT * FROM audit_log WHERE tenant_id = ? AND target = ? ORDER BY created_at ASC`).all(this.tenantId, target) as AuditLogRow[];
    return rows.map(rowToEntry);
  }
}
