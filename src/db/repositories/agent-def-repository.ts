import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export interface AgentDef {
  id: string;
  tenantId: string;
  key: string;
  version: number;
  status: "draft" | "published";
  systemPrompt: string;
  modelAlias: string;
  toolIds: string[];
  kbScope: Record<string, unknown>;
  handoffTargets: string[];
  guardrails: Record<string, unknown>;
}

interface AgentDefRow {
  id: string;
  tenant_id: string;
  key: string;
  version: number;
  status: "draft" | "published";
  system_prompt: string;
  model_alias: string;
  tool_ids: string;
  kb_scope: string;
  handoff_targets: string;
  guardrails: string;
}

function rowToAgentDef(row: AgentDefRow): AgentDef {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    key: row.key,
    version: row.version,
    status: row.status,
    systemPrompt: row.system_prompt,
    modelAlias: row.model_alias,
    toolIds: JSON.parse(row.tool_ids) as string[],
    kbScope: JSON.parse(row.kb_scope) as Record<string, unknown>,
    handoffTargets: JSON.parse(row.handoff_targets) as string[],
    guardrails: JSON.parse(row.guardrails) as Record<string, unknown>,
  };
}

/** FR-6.1 (agents are data, not code) + FR-6.3 (versioning with publish). */
export class AgentDefRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  publish(input: {
    key: string;
    systemPrompt: string;
    modelAlias: string;
    toolIds?: string[];
    kbScope?: Record<string, unknown>;
    handoffTargets?: string[];
    guardrails?: Record<string, unknown>;
  }): AgentDef {
    const nextVersion = this.latestVersion(input.key) + 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_defs (
           id, tenant_id, key, version, status, system_prompt, model_alias,
           tool_ids, kb_scope, handoff_targets, guardrails, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.key,
        nextVersion,
        input.systemPrompt,
        input.modelAlias,
        JSON.stringify(input.toolIds ?? []),
        JSON.stringify(input.kbScope ?? {}),
        JSON.stringify(input.handoffTargets ?? []),
        JSON.stringify(input.guardrails ?? {}),
        now,
        now,
      );
    return {
      id,
      tenantId: this.tenantId,
      key: input.key,
      version: nextVersion,
      status: "published",
      systemPrompt: input.systemPrompt,
      modelAlias: input.modelAlias,
      toolIds: input.toolIds ?? [],
      kbScope: input.kbScope ?? {},
      handoffTargets: input.handoffTargets ?? [],
      guardrails: input.guardrails ?? {},
    };
  }

  /** A running conversation pins the version it started with (FR-6.3) — call with an explicit version to pin. */
  getVersion(key: string, version: number): AgentDef | undefined {
    const row = this.db
      .prepare(`SELECT * FROM agent_defs WHERE tenant_id = ? AND key = ? AND version = ?`)
      .get(this.tenantId, key, version) as AgentDefRow | undefined;
    return row ? rowToAgentDef(row) : undefined;
  }

  getLatestPublished(key: string): AgentDef | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM agent_defs WHERE tenant_id = ? AND key = ? AND status = 'published'
         ORDER BY version DESC LIMIT 1`,
      )
      .get(this.tenantId, key) as AgentDefRow | undefined;
    return row ? rowToAgentDef(row) : undefined;
  }

  private latestVersion(key: string): number {
    const row = this.db
      .prepare(`SELECT MAX(version) as maxVersion FROM agent_defs WHERE tenant_id = ? AND key = ?`)
      .get(this.tenantId, key) as { maxVersion: number | null };
    return row.maxVersion ?? 0;
  }
}
