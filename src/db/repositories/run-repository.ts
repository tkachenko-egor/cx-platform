import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface Run {
  id: string;
  tenantId: string;
  conversationId: string;
  agentKey: string;
  agentVersion: number;
  trigger: string;
  status: "running" | "completed" | "failed";
}

interface RunRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  agent_key: string;
  agent_version: number;
  trigger: string;
  status: "running" | "completed" | "failed";
}

/** Ties one conversation turn to every llm_call/tool_call it produced (data-model sketch). */
export class RunRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async start(input: { conversationId: string; agentKey: string; agentVersion: number; trigger: string }): Promise<Run> {
    const id = randomUUID();
    await this.db
      .prepare(
        `INSERT INTO runs (id, tenant_id, conversation_id, agent_key, agent_version, trigger, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(id, this.tenantId, input.conversationId, input.agentKey, input.agentVersion, input.trigger, new Date().toISOString());
    return {
      id,
      tenantId: this.tenantId,
      conversationId: input.conversationId,
      agentKey: input.agentKey,
      agentVersion: input.agentVersion,
      trigger: input.trigger,
      status: "running",
    };
  }

  async complete(id: string, status: "completed" | "failed"): Promise<void> {
    await this.db
      .prepare(`UPDATE runs SET status = ?, ended_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(status, new Date().toISOString(), this.tenantId, id);
  }

  async listByConversation(conversationId: string): Promise<Run[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM runs WHERE tenant_id = ? AND conversation_id = ? ORDER BY started_at ASC`)
      .all(this.tenantId, conversationId) as RunRow[];
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      agentKey: row.agent_key,
      agentVersion: row.agent_version,
      trigger: row.trigger,
      status: row.status,
    }));
  }
}
