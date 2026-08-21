import type Database from "better-sqlite3";
import { getPlatformContext } from "../../../../src/platform/context";
import { AgentDefRepository, type AgentNativeToolsConfig } from "../../../../src/db/repositories/agent-def-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";
import { ensureVectorStore } from "../../../../src/kb/openai-vector-store-sync";
import type { TenantContext } from "../../../../src/tenancy/context";

export const runtime = "nodejs";

/** When File Search is turned on, make sure every KB collection this agent draws from has a vector store — provisioning + backfilling any that don't yet. Best-effort: a failure here shouldn't block publishing the agent itself. */
async function provisionFileSearch(db: Database.Database, tenant: TenantContext, nativeTools: AgentNativeToolsConfig | undefined, kbScope: Record<string, unknown> | undefined): Promise<void> {
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
  };
  if (!body.key || !body.systemPrompt || !body.modelAlias) {
    return Response.json({ error: "key, systemPrompt, and modelAlias are required" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const agentDefs = new AgentDefRepository(db, tenant);
  const current = agentDefs.getLatestPublished(body.key);

  if (body.isCreate) {
    if (current) return Response.json({ error: `An agent with key "${body.key}" already exists` }, { status: 400 });

    await provisionFileSearch(db, tenant, body.nativeTools, body.kbScope);

    const created = agentDefs.publish({
      key: body.key,
      systemPrompt: body.systemPrompt,
      modelAlias: body.modelAlias,
      toolIds: body.toolIds ?? [],
      skills: body.skills ?? [],
      guardrails: body.guardrails ?? {},
      kbScope: body.kbScope ?? {},
      nativeTools: body.nativeTools ?? {},
      quickReplies: body.quickReplies ?? [],
    });

    new AuditLogRepository(db, tenant).record({
      actorUserId: actor.id,
      action: "agent_def_created",
      target: body.key,
      after: { version: created.version },
    });

    return Response.json({ ok: true, agentDef: created });
  }

  if (!current) return Response.json({ error: `No published agent def found for key "${body.key}"` }, { status: 404 });

  const nativeTools = body.nativeTools ?? current.nativeTools;
  const kbScope = body.kbScope ?? current.kbScope;
  await provisionFileSearch(db, tenant, nativeTools, kbScope);

  const published = agentDefs.publish({
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
  });

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "agent_def_published",
    target: body.key,
    before: { version: current.version },
    after: { version: published.version },
  });

  return Response.json({ ok: true, agentDef: published });
}
