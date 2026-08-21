import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import { AgentExperimentRepository } from "./agent-experiment-repository";

/** Deterministic, not random — the same conversation always lands in the same variant bucket for a given experiment, without needing to persist "which variant" separately from the version pin it already gets (conversation.metadata.agentVersion). */
function hashToUnitInterval(input: string): number {
  const digest = createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0) / 0x100000000;
}

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
  /** Phase 2 M3c: capability tags surfaced to the router so it can pick a specialist on more than the raw key. */
  skills: string[];
  /** Phase 2 M3b: opt-in per-agent semantic response cache (default off — see src/kb/semantic-cache.ts). */
  semanticCacheEnabled: boolean;
  /** Phase 6 M3: OpenAI native-hosted-tool config — only meaningful when modelAlias resolves to the openai provider. */
  nativeTools: AgentNativeToolsConfig;
  /** Phase 6 M5: admin-authored canned reply chips shown at the start of a conversation. */
  quickReplies: string[];
}

export interface AgentNativeToolsConfig {
  webSearch?: boolean;
  fileSearch?: boolean;
  mcp?: { enabled: boolean; serverLabel?: string; serverUrl?: string; headers?: Record<string, string> };
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
  skills: string;
  semantic_cache_enabled: number;
  native_tools: string;
  quick_replies: string;
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
    skills: JSON.parse(row.skills) as string[],
    semanticCacheEnabled: row.semantic_cache_enabled === 1,
    nativeTools: JSON.parse(row.native_tools) as AgentNativeToolsConfig,
    quickReplies: JSON.parse(row.quick_replies) as string[],
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
    skills?: string[];
    semanticCacheEnabled?: boolean;
    nativeTools?: AgentNativeToolsConfig;
    quickReplies?: string[];
  }): AgentDef {
    const nextVersion = this.latestVersion(input.key) + 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_defs (
           id, tenant_id, key, version, status, system_prompt, model_alias,
           tool_ids, kb_scope, handoff_targets, guardrails, skills, semantic_cache_enabled,
           native_tools, quick_replies, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(input.skills ?? []),
        input.semanticCacheEnabled ? 1 : 0,
        JSON.stringify(input.nativeTools ?? {}),
        JSON.stringify(input.quickReplies ?? []),
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
      skills: input.skills ?? [],
      semanticCacheEnabled: input.semanticCacheEnabled ?? false,
      nativeTools: input.nativeTools ?? {},
      quickReplies: input.quickReplies ?? [],
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

  /** Phase 2 M3c: the router's own skill-tag enrichment reads each handoff target's latest published def this way. */
  listByKeys(keys: string[]): AgentDef[] {
    return keys.map((key) => this.getLatestPublished(key)).filter((def): def is AgentDef => Boolean(def));
  }

  /**
   * Phase 2 M6a: the "which version does this conversation start on" call —
   * used at the moment an agent is newly assigned to a conversation
   * (router's target, a mid-turn handoff's next agent, or the
   * no-router default agent), never for re-fetching an already-pinned
   * version. No active experiment -> getLatestPublished, unchanged
   * (zero behavior change for tenants without one, same precedent as the
   * router itself). With an experiment: hash(conversationId + agentKey)
   * against trafficSplit picks A or B, deterministically and stably.
   */
  getForTraffic(key: string, conversationId: string): AgentDef | undefined {
    const experiment = new AgentExperimentRepository(this.db, { tenantId: this.tenantId }).getActive(key);
    if (!experiment) return this.getLatestPublished(key);

    const bucket = hashToUnitInterval(`${conversationId}:${key}`);
    const variantVersion = bucket < experiment.trafficSplit ? experiment.variantBVersion : experiment.variantAVersion;
    return this.getVersion(key, variantVersion) ?? this.getLatestPublished(key);
  }

  /** Phase 2 M6a admin UI: every published version of every agent, for building a "pick a variant" form. */
  listAllPublished(): AgentDef[] {
    const rows = this.db.prepare(`SELECT * FROM agent_defs WHERE tenant_id = ? AND status = 'published' ORDER BY key, version`).all(this.tenantId) as AgentDefRow[];
    return rows.map(rowToAgentDef);
  }

  /** Phase 6 M4: every published version of one agent, newest first — powers the Prompt card's version history dropdown. */
  listVersions(key: string): AgentDef[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_defs WHERE tenant_id = ? AND key = ? AND status = 'published' ORDER BY version DESC`)
      .all(this.tenantId, key) as AgentDefRow[];
    return rows.map(rowToAgentDef);
  }

  private latestVersion(key: string): number {
    const row = this.db
      .prepare(`SELECT MAX(version) as maxVersion FROM agent_defs WHERE tenant_id = ? AND key = ?`)
      .get(this.tenantId, key) as { maxVersion: number | null };
    return row.maxVersion ?? 0;
  }
}
