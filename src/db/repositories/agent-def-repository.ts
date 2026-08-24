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
  /** Phase 7 M1: customer-facing name — falls back to `key` wherever displayed if blank. */
  displayName: string;
  avatarUrl: string | null;
  /** Phase 7 M1: for the admin team, not the model — never injected into the system prompt. */
  internalDescription: string;
  ownerUserId: string | null;
  tags: string[];
  /** Phase 7 M1: gates routing — see src/channel/turn.ts. Distinct from `status` (draft/published), which is about version publishing, not this admin-facing lifecycle. */
  agentStatus: "draft" | "active" | "paused" | "archived";
  /** Phase 7 M1: gates write-tool execution — see src/tools/registry.ts's sandbox short-circuit. */
  environment: "sandbox" | "production";
  changeNotes: string;
  /** Phase 7 M2: undefined lets the provider use its own default. */
  temperature: number | null;
  maxOutputTokens: number | null;
  /** Phase 7 M2: per-conversation spend cap in USD — null/undefined means unlimited. */
  costCeilingUsd: number | null;
  /** Phase 7 M3: tone/formality/canned-messages config — see src/agents/system-prompt.ts's personaBlock(). */
  persona: AgentPersonaConfig;
  /** Phase 7 M3: supported-language/auto-detect config — see src/agents/system-prompt.ts's languageBlock(). */
  languageConfig: AgentLanguageConfig;
}

export interface AgentNativeToolsConfig {
  webSearch?: boolean;
  fileSearch?: boolean;
  mcp?: { enabled: boolean; serverLabel?: string; serverUrl?: string; headers?: Record<string, string> };
}

export interface AgentCannedMessages {
  greeting?: string;
  fallback?: string;
  handoff?: string;
  outOfHours?: string;
  idleTimeout?: string;
}

export interface AgentCannedMessageOverride extends AgentCannedMessages {
  channel?: string;
  language?: string;
}

export interface AgentPersonaConfig {
  tone?: string;
  customTone?: string;
  formality?: "ty" | "vy" | "auto";
  responseLength?: "brief" | "standard" | "detailed";
  emojiPolicy?: "never" | "sparing" | "liberal";
  doNotSayList?: string[];
  brandVocabulary?: string[];
  cannedMessages?: { default?: AgentCannedMessages; overrides?: AgentCannedMessageOverride[] };
}

export interface AgentLanguageConfig {
  supportedLanguages?: string[];
  defaultLanguage?: string;
  autoDetect?: boolean;
  alwaysAnswerInCustomerLanguage?: boolean;
  mixedInputHandling?: "transliterate_to_native" | "answer_as_written" | "ask_preference";
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
  display_name: string;
  avatar_url: string | null;
  internal_description: string;
  owner_user_id: string | null;
  tags: string;
  agent_status: "draft" | "active" | "paused" | "archived";
  environment: "sandbox" | "production";
  change_notes: string;
  temperature: number | null;
  max_output_tokens: number | null;
  cost_ceiling_usd: number | null;
  persona: string;
  language_config: string;
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
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    internalDescription: row.internal_description,
    ownerUserId: row.owner_user_id,
    tags: JSON.parse(row.tags) as string[],
    agentStatus: row.agent_status,
    environment: row.environment,
    changeNotes: row.change_notes,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    costCeilingUsd: row.cost_ceiling_usd,
    persona: JSON.parse(row.persona) as AgentPersonaConfig,
    languageConfig: JSON.parse(row.language_config) as AgentLanguageConfig,
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
    displayName?: string;
    avatarUrl?: string | null;
    internalDescription?: string;
    ownerUserId?: string | null;
    tags?: string[];
    /** Defaults to 'active' — matching schema.sql's column default — so any caller that doesn't think about lifecycle (tests, seed scripts) keeps publishing routable agents. The create-agent API route is the one place that consciously passes 'draft' instead. */
    agentStatus?: "draft" | "active" | "paused" | "archived";
    /** Defaults to 'production' for the same reason — see agentStatus above. */
    environment?: "sandbox" | "production";
    changeNotes?: string;
    temperature?: number | null;
    maxOutputTokens?: number | null;
    costCeilingUsd?: number | null;
    persona?: AgentPersonaConfig;
    languageConfig?: AgentLanguageConfig;
  }): AgentDef {
    const nextVersion = this.latestVersion(input.key) + 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    const displayName = input.displayName ?? "";
    const avatarUrl = input.avatarUrl ?? null;
    const internalDescription = input.internalDescription ?? "";
    const ownerUserId = input.ownerUserId ?? null;
    const tags = input.tags ?? [];
    const agentStatus = input.agentStatus ?? "active";
    const environment = input.environment ?? "production";
    const changeNotes = input.changeNotes ?? "";
    const temperature = input.temperature ?? null;
    const maxOutputTokens = input.maxOutputTokens ?? null;
    const costCeilingUsd = input.costCeilingUsd ?? null;
    const persona = input.persona ?? {};
    const languageConfig = input.languageConfig ?? {};
    this.db
      .prepare(
        `INSERT INTO agent_defs (
           id, tenant_id, key, version, status, system_prompt, model_alias,
           tool_ids, kb_scope, handoff_targets, guardrails, skills, semantic_cache_enabled,
           native_tools, quick_replies, display_name, avatar_url, internal_description,
           owner_user_id, tags, agent_status, environment, change_notes,
           temperature, max_output_tokens, cost_ceiling_usd, persona, language_config,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        displayName,
        avatarUrl,
        internalDescription,
        ownerUserId,
        JSON.stringify(tags),
        agentStatus,
        environment,
        changeNotes,
        temperature,
        maxOutputTokens,
        costCeilingUsd,
        JSON.stringify(persona),
        JSON.stringify(languageConfig),
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
      displayName,
      avatarUrl,
      internalDescription,
      ownerUserId,
      tags,
      agentStatus,
      environment,
      changeNotes,
      temperature,
      maxOutputTokens,
      costCeilingUsd,
      persona,
      languageConfig,
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
