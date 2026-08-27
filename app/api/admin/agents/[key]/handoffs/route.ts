import { getPlatformContext } from "../../../../../../src/platform/context";
import { AgentDefRepository } from "../../../../../../src/db/repositories/agent-def-repository";
import { AuditLogRepository } from "../../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** The "Hands off to" card's write path (components/admin/AgentEditor.tsx, Tools & skills tab) — bot-level routing, edited per-agent. A full republish of the target agent with only handoffTargets changed — publish() has no partial-update variant, and shouldn't get one (see M5's carry-forward note in app/api/admin/agents/route.ts for the same reasoning in reverse). */
export async function PATCH(req: Request, context: RouteContext<"/api/admin/agents/[key]/handoffs">) {
  const { key } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { handoffTargets?: string[] };
  if (!Array.isArray(body.handoffTargets) || body.handoffTargets.some((t) => typeof t !== "string")) {
    return Response.json({ error: "handoffTargets must be an array of agent keys" }, { status: 400 });
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
  const current = await agentDefs.getLatestPublished(key);
  if (!current) return Response.json({ error: `No published agent def found for key "${key}"` }, { status: 404 });

  const published = await agentDefs.publish({
    key: current.key,
    systemPrompt: current.systemPrompt,
    modelAlias: current.modelAlias,
    toolIds: current.toolIds,
    kbScope: current.kbScope,
    handoffTargets: body.handoffTargets,
    guardrails: current.guardrails,
    skills: current.skills,
    semanticCacheEnabled: current.semanticCacheEnabled,
  });

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "agent_handoff_targets_updated",
    target: key,
    before: { handoffTargets: current.handoffTargets },
    after: { handoffTargets: published.handoffTargets },
  });

  return Response.json({ ok: true, agentDef: published });
}
