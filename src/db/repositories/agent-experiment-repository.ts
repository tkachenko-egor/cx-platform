import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export type AgentExperimentStatus = "active" | "stopped";

export interface AgentExperiment {
  id: string;
  tenantId: string;
  agentKey: string;
  variantAVersion: number;
  variantBVersion: number;
  /** Weight toward variant B, 0-1. */
  trafficSplit: number;
  status: AgentExperimentStatus;
  createdAt: string;
}

interface AgentExperimentRow {
  id: string;
  tenant_id: string;
  agent_key: string;
  variant_a_version: number;
  variant_b_version: number;
  traffic_split: number;
  status: AgentExperimentStatus;
  created_at: string;
}

function rowToExperiment(row: AgentExperimentRow): AgentExperiment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentKey: row.agent_key,
    variantAVersion: row.variant_a_version,
    variantBVersion: row.variant_b_version,
    trafficSplit: row.traffic_split,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Phase 2 M6a: A/B testing on top of agent_defs' existing versioning — see AgentDefRepository.getForTraffic for the assignment logic that reads this. */
export class AgentExperimentRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  /** Throws on SQLite's own uniqueness violation if an active experiment already exists for this agent_key (idx_agent_experiments_one_active). */
  async create(input: { agentKey: string; variantAVersion: number; variantBVersion: number; trafficSplit: number }): Promise<AgentExperiment> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO agent_experiments (id, tenant_id, agent_key, variant_a_version, variant_b_version, traffic_split, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(id, this.tenantId, input.agentKey, input.variantAVersion, input.variantBVersion, input.trafficSplit, now);
    return { id, tenantId: this.tenantId, agentKey: input.agentKey, variantAVersion: input.variantAVersion, variantBVersion: input.variantBVersion, trafficSplit: input.trafficSplit, status: "active", createdAt: now };
  }

  async getActive(agentKey: string): Promise<AgentExperiment | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM agent_experiments WHERE tenant_id = ? AND agent_key = ? AND status = 'active'`)
      .get(this.tenantId, agentKey) as AgentExperimentRow | undefined;
    return row ? rowToExperiment(row) : undefined;
  }

  async stop(id: string): Promise<void> {
    await this.db.prepare(`UPDATE agent_experiments SET status = 'stopped' WHERE tenant_id = ? AND id = ?`).run(this.tenantId, id);
  }

  async list(): Promise<AgentExperiment[]> {
    const rows = await this.db.prepare(`SELECT * FROM agent_experiments WHERE tenant_id = ? ORDER BY created_at DESC`).all(this.tenantId) as AgentExperimentRow[];
    return rows.map(rowToExperiment);
  }
}
