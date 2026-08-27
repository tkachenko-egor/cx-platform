import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export type AgentPublishApprovalStatus = "pending" | "approved" | "rejected";

export interface AgentPublishApproval {
  id: string;
  tenantId: string;
  agentKey: string;
  requestedVersion: number;
  requestedBy: string;
  /** The full agent_defs.publish() input, as submitted — replayed verbatim on approval rather than re-derived. */
  payload: Record<string, unknown>;
  fromStatus: string;
  toStatus: string;
  fromEnvironment: string;
  toEnvironment: string;
  status: AgentPublishApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface AgentPublishApprovalRow {
  id: string;
  tenant_id: string;
  agent_key: string;
  requested_version: number;
  requested_by: string;
  payload: string;
  from_status: string;
  to_status: string;
  from_environment: string;
  to_environment: string;
  status: AgentPublishApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

function rowToApproval(row: AgentPublishApprovalRow): AgentPublishApproval {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentKey: row.agent_key,
    requestedVersion: row.requested_version,
    requestedBy: row.requested_by,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    fromEnvironment: row.from_environment,
    toEnvironment: row.to_environment,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/** Phase 8 M3: the parking lot for a supervisor's attempt to publish an agent live — see src/db/migrations/023-escalation-config-and-publish-approvals.ts. */
export class AgentPublishApprovalRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: {
    agentKey: string;
    requestedVersion: number;
    requestedBy: string;
    payload: Record<string, unknown>;
    fromStatus: string;
    toStatus: string;
    fromEnvironment: string;
    toEnvironment: string;
  }): Promise<AgentPublishApproval> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_publish_approvals (
           id, tenant_id, agent_key, requested_version, requested_by, payload,
           from_status, to_status, from_environment, to_environment, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.agentKey,
        input.requestedVersion,
        input.requestedBy,
        JSON.stringify(input.payload),
        input.fromStatus,
        input.toStatus,
        input.fromEnvironment,
        input.toEnvironment,
        now,
      );
    return (await this.get(id))!;
  }

  async get(id: string): Promise<AgentPublishApproval | undefined> {
    const row = this.db.prepare(`SELECT * FROM agent_publish_approvals WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as AgentPublishApprovalRow | undefined;
    return row ? rowToApproval(row) : undefined;
  }

  async listPending(): Promise<AgentPublishApproval[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agent_publish_approvals WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC`)
      .all(this.tenantId) as AgentPublishApprovalRow[];
    return rows.map(rowToApproval);
  }

  async markDecided(id: string, status: "approved" | "rejected", decidedBy: string): Promise<void> {
    this.db
      .prepare(`UPDATE agent_publish_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(status, decidedBy, new Date().toISOString(), this.tenantId, id);
  }
}
