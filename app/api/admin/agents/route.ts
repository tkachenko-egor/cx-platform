import { getPlatformContext } from "../../../../src/platform/context";
import type { SqlDatabase } from "../../../../src/db/pg";
import {
  AgentDefRepository,
  type AgentNativeToolsConfig,
  type AgentPersonaConfig,
  type AgentLanguageConfig,
  type AgentEscalationConfig,
  type AgentConversationConfig,
} from "../../../../src/db/repositories/agent-def-repository";
import { AgentPublishApprovalRepository } from "../../../../src/db/repositories/agent-publish-approval-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";
import { roleAtLeast } from "../../../../src/auth/permissions";
import type { User } from "../../../../src/db/repositories/user-repository";
import { ensureVectorStore } from "../../../../src/kb/openai-vector-store-sync";
import type { TenantContext } from "../../../../src/tenancy/context";
import type { BusinessHoursConfig } from "../../../../src/db/repositories/tenant-repository";

export const runtime = "nodejs";

/**
 * Phase 8 M3: a supervisor can save an agent freely as long as it stays
 * non-live (draft/paused/archived, or sandbox) — only the transition to
 * *actually customer-facing* (status=active AND environment=production
 * together) needs an admin/owner's approval. When gated, this queues an
 * agent_publish_approvals row carrying the exact resolved publish() input
 * and returns it instead of calling publish() — the caller (POST below)
 * decides whether to publish immediately or return pendingApproval based on
 * this function's result.
 */
function requiresApprovalGate(actor: User, agentStatus: string, environment: string): boolean {
  const goingLive = agentStatus === "active" && environment === "production";
  return goingLive && !roleAtLeast(actor.role, "admin");
}

/** When File Search is turned on, make sure every KB collection this agent draws from has a vector store — provisioning + backfilling any that don't yet. Best-effort: a failure here shouldn't block publishing the agent itself. */
async function provisionFileSearch(db: SqlDatabase, tenant: TenantContext, nativeTools: AgentNativeToolsConfig | undefined, kbScope: Record<string, unknown> | undefined): Promise<void> {
  if (!nativeTools?.fileSearch) return;
  const collectionIds = Array.isArray(kbScope?.collectionIds) ? (kbScope.collectionIds as string[]) : [];
  for (const collectionId of collectionIds) {
    try {
      await ensureVectorStore(db, tenant, collectionId);
    } catch (err) {
      console.error(`File Search provisioning failed for collection ${collectionId}:`, err);
    }
  }
}

/**
 * Phase 3 M5 (edit) + Phase 4 M2 (create): publishes an agent_defs version.
 * Always a full republish (AgentDefRepository.publish() has no
 * partial-update variant, and shouldn't get one — agent_defs is append-only
 * by design).
 *
 * `isCreate` picks which of two mutually exclusive paths runs — never both,
 * so this can neither 404 on a real create nor silently version over an
 * existing agent from the create form:
 *   - isCreate: true  -> 400 if the key already exists (never overwrite);
 *     kbScope/handoffTargets/semanticCacheEnabled start empty, nothing to
 *     carry forward on a brand-new agent.
 *   - isCreate: false/absent (the edit page's default) -> 404 if the key
 *     doesn't exist yet; the editor form only touches
 *     prompt/model/tools/skills/guardrails, so kbScope/handoffTargets/
 *     semanticCacheEnabled are carried forward from the current version
 *     rather than silently reset to publish()'s defaults.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    key?: string;
    isCreate?: boolean;
    systemPrompt?: string;
    modelAlias?: string;
    toolIds?: string[];
    skills?: string[];
    guardrails?: Record<string, unknown>;
    kbScope?: Record<string, unknown>;
    nativeTools?: AgentNativeToolsConfig;
    quickReplies?: string[];
    displayName?: string;
    avatarUrl?: string | null;
    internalDescription?: string;
    ownerUserId?: string | null;
    tags?: string[];
    agentStatus?: "draft" | "active" | "paused" | "archived";
    environment?: "sandbox" | "production";
    changeNotes?: string;
    temperature?: number | null;
    maxOutputTokens?: number | null;
    costCeilingUsd?: number | null;
    persona?: AgentPersonaConfig;
    languageConfig?: AgentLanguageConfig;
    escalationConfig?: AgentEscalationConfig;
    conversationConfig?: AgentConversationConfig;
    enabledChannels?: string[];
    businessHours?: BusinessHoursConfig | null;
  };
  if (!body.key || !body.systemPrompt || !body.modelAlias) {
    return Response.json({ error: "key, systemPrompt, and modelAlias are required" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    // Phase 8 M3: loosened from "admin" — a supervisor can edit/save an
    // agent (see requiresApprovalGate below for what still needs an
    // admin/owner directly).
    actor = await requireRole(db, tenant, "supervisor");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const agentDefs = new AgentDefRepository(db, tenant);
  const current = await agentDefs.getLatestPublished(body.key);

  if (body.isCreate) {
    if (current) return Response.json({ error: `An agent with key "${body.key}" already exists` }, { status: 400 });

    await provisionFileSearch(db, tenant, body.nativeTools, body.kbScope);

    const publishInput = {
      key: body.key,
      systemPrompt: body.systemPrompt,
      modelAlias: body.modelAlias,
      toolIds: body.toolIds ?? [],
      skills: body.skills ?? [],
      guardrails: body.guardrails ?? {},
      kbScope: body.kbScope ?? {},
      nativeTools: body.nativeTools ?? {},
      quickReplies: body.quickReplies ?? [],
      displayName: body.displayName ?? "",
      avatarUrl: body.avatarUrl ?? null,
      internalDescription: body.internalDescription ?? "",
      ownerUserId: body.ownerUserId ?? actor.id,
      tags: body.tags ?? [],
      // Safe-by-default: a brand-new agent starts non-routable and
      // write-simulated until an admin explicitly promotes it — see the plan's
      // confirmed defaults. Still overridable if the form sends an explicit value.
      agentStatus: body.agentStatus ?? "draft",
      environment: body.environment ?? "sandbox",
      changeNotes: body.changeNotes ?? "",
      temperature: body.temperature ?? null,
      maxOutputTokens: body.maxOutputTokens ?? null,
      costCeilingUsd: body.costCeilingUsd ?? null,
      persona: body.persona ?? {},
      languageConfig: body.languageConfig ?? {},
      escalationConfig: body.escalationConfig ?? {},
      conversationConfig: body.conversationConfig ?? {},
      enabledChannels: body.enabledChannels ?? [],
      businessHours: body.businessHours ?? null,
    };

    if (requiresApprovalGate(actor, publishInput.agentStatus, publishInput.environment)) {
      const approval = await new AgentPublishApprovalRepository(db, tenant).create({
        agentKey: body.key,
        requestedVersion: 1,
        requestedBy: actor.id,
        payload: publishInput,
        fromStatus: "none",
        toStatus: publishInput.agentStatus,
        fromEnvironment: "none",
        toEnvironment: publishInput.environment,
      });
      await new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "agent_publish_requested", target: body.key, after: { approvalId: approval.id } });
      return Response.json({ ok: true, pendingApproval: true, approvalId: approval.id });
    }

    const created = await agentDefs.publish(publishInput);

    await new AuditLogRepository(db, tenant).record({
      actorUserId: actor.id,
      action: "agent_def_created",
      target: body.key,
      after: { version: created.version, agentStatus: created.agentStatus, environment: created.environment },
    });

    return Response.json({ ok: true, agentDef: created });
  }

  if (!current) return Response.json({ error: `No published agent def found for key "${body.key}"` }, { status: 404 });

  const nativeTools = body.nativeTools ?? current.nativeTools;
  const kbScope = body.kbScope ?? current.kbScope;
  await provisionFileSearch(db, tenant, nativeTools, kbScope);

  const publishInput = {
    key: body.key,
    systemPrompt: body.systemPrompt,
    modelAlias: body.modelAlias,
    toolIds: body.toolIds ?? current.toolIds,
    skills: body.skills ?? current.skills,
    guardrails: body.guardrails ?? current.guardrails,
    kbScope,
    handoffTargets: current.handoffTargets,
    semanticCacheEnabled: current.semanticCacheEnabled,
    nativeTools,
    quickReplies: body.quickReplies ?? current.quickReplies,
    displayName: body.displayName ?? current.displayName,
    avatarUrl: body.avatarUrl !== undefined ? body.avatarUrl : current.avatarUrl,
    internalDescription: body.internalDescription ?? current.internalDescription,
    ownerUserId: body.ownerUserId !== undefined ? body.ownerUserId : current.ownerUserId,
    tags: body.tags ?? current.tags,
    agentStatus: body.agentStatus ?? current.agentStatus,
    environment: body.environment ?? current.environment,
    changeNotes: body.changeNotes ?? "",
    temperature: body.temperature !== undefined ? body.temperature : current.temperature,
    maxOutputTokens: body.maxOutputTokens !== undefined ? body.maxOutputTokens : current.maxOutputTokens,
    costCeilingUsd: body.costCeilingUsd !== undefined ? body.costCeilingUsd : current.costCeilingUsd,
    persona: body.persona ?? current.persona,
    languageConfig: body.languageConfig ?? current.languageConfig,
    escalationConfig: body.escalationConfig ?? current.escalationConfig,
    conversationConfig: body.conversationConfig ?? current.conversationConfig,
    enabledChannels: body.enabledChannels ?? current.enabledChannels,
    businessHours: body.businessHours !== undefined ? body.businessHours : current.businessHours,
  };

  if (requiresApprovalGate(actor, publishInput.agentStatus, publishInput.environment)) {
    const approval = await new AgentPublishApprovalRepository(db, tenant).create({
      agentKey: body.key,
      requestedVersion: current.version + 1,
      requestedBy: actor.id,
      payload: publishInput,
      fromStatus: current.agentStatus,
      toStatus: publishInput.agentStatus,
      fromEnvironment: current.environment,
      toEnvironment: publishInput.environment,
    });
    await new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "agent_publish_requested", target: body.key, after: { approvalId: approval.id } });
    return Response.json({ ok: true, pendingApproval: true, approvalId: approval.id });
  }

  const published = await agentDefs.publish(publishInput);

  await new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "agent_def_published",
    target: body.key,
    before: { version: current.version, agentStatus: current.agentStatus, environment: current.environment },
    after: { version: published.version, agentStatus: published.agentStatus, environment: published.environment, changeNotes: published.changeNotes },
  });

  return Response.json({ ok: true, agentDef: published });
}
