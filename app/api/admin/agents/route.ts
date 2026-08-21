import { getPlatformContext } from "../../../../src/platform/context";
import { AgentDefRepository } from "../../../../src/db/repositories/agent-def-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

/**
 * Phase 3 M5: publishes a new agent_defs version. Always a full republish
 * (AgentDefRepository.publish() has no partial-update variant, and
 * shouldn't get one — agent_defs is append-only by design). The editor
 * form only touches prompt/model/tools/skills/guardrails, so
 * kbScope/handoffTargets/semanticCacheEnabled are carried forward from the
 * current version rather than silently reset to publish()'s defaults.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    key?: string;
    systemPrompt?: string;
    modelAlias?: string;
    toolIds?: string[];
    skills?: string[];
    guardrails?: Record<string, unknown>;
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
  if (!current) return Response.json({ error: `No published agent def found for key "${body.key}"` }, { status: 404 });

  const published = agentDefs.publish({
    key: body.key,
    systemPrompt: body.systemPrompt,
    modelAlias: body.modelAlias,
    toolIds: body.toolIds ?? current.toolIds,
    skills: body.skills ?? current.skills,
    guardrails: body.guardrails ?? current.guardrails,
    kbScope: current.kbScope,
    handoffTargets: current.handoffTargets,
    semanticCacheEnabled: current.semanticCacheEnabled,
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
