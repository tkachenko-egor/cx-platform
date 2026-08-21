import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { ApprovalPolicy } from "./tool-repository";

export type ToolApprovalStatus = "pending" | "approved" | "denied";

export interface ToolApproval {
  id: string;
  tenantId: string;
  runId: string;
  conversationId: string;
  toolKey: string;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
  policy: Exclude<ApprovalPolicy, "auto">;
  status: ToolApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface ToolApprovalRow {
  id: string;
  tenant_id: string;
  run_id: string;
  conversation_id: string;
  tool_key: string;
  arguments: string;
  idempotency_key: string;
  policy: Exclude<ApprovalPolicy, "auto">;
  status: ToolApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

function rowToApproval(row: ToolApprovalRow): ToolApproval {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    toolKey: row.tool_key,
    arguments: JSON.parse(row.arguments) as Record<string, unknown>,
    idempotencyKey: row.idempotency_key,
    policy: row.policy,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/** FR-8.5: the parking lot for write-tool calls whose approval_policy isn't 'auto'. */
export class ToolApprovalRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  create(input: {
    runId: string;
    conversationId: string;
    toolKey: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    policy: Exclude<ApprovalPolicy, "auto">;
  }): ToolApproval {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tool_approvals (id, tenant_id, run_id, conversation_id, tool_key, arguments, idempotency_key, policy, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, this.tenantId, input.runId, input.conversationId, input.toolKey, JSON.stringify(input.arguments), input.idempotencyKey, input.policy, now);
    return this.get(id)!;
  }

  get(id: string): ToolApproval | undefined {
    const row = this.db.prepare(`SELECT * FROM tool_approvals WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as ToolApprovalRow | undefined;
    return row ? rowToApproval(row) : undefined;
  }

  getByIdempotencyKey(idempotencyKey: string): ToolApproval | undefined {
    const row = this.db.prepare(`SELECT * FROM tool_approvals WHERE tenant_id = ? AND idempotency_key = ?`).get(this.tenantId, idempotencyKey) as ToolApprovalRow | undefined;
    return row ? rowToApproval(row) : undefined;
  }

  markDecided(id: string, status: "approved" | "denied", decidedBy: string | null): void {
    this.db
      .prepare(`UPDATE tool_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(status, decidedBy, new Date().toISOString(), this.tenantId, id);
  }

  listPendingByConversation(conversationId: string): ToolApproval[] {
    const rows = this.db
      .prepare(`SELECT * FROM tool_approvals WHERE tenant_id = ? AND conversation_id = ? AND status = 'pending' ORDER BY created_at ASC`)
      .all(this.tenantId, conversationId) as ToolApprovalRow[];
    return rows.map(rowToApproval);
  }
}
