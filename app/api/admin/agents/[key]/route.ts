import { getPlatformContext } from "../../../../../src/platform/context";
import { AgentDefRepository } from "../../../../../src/db/repositories/agent-def-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/**
 * Milestone 5 (Archive = delete): agent_defs rows can never be truly
 * deleted (FK'd from conversations/runs), so "Delete agent" in the Agents
 * list archives it instead — same append-only publish() every other
 * lifecycle change goes through, just with agentStatus forced to
 * 'archived' and everything else carried forward unchanged from the
 * current published version.
 */
export async function DELETE(_req: Request, props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const agentDefs = new AgentDefRepository(db, tenant);
  const current = agentDefs.getLatestPublished(key);
  if (!current) return Response.json({ error: `No published agent def found for key "${key}"` }, { status: 404 });

  const archived = agentDefs.publish({ ...current, agentStatus: "archived", changeNotes: "Archived" });
  agentDefs.clearDraft(key);

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "agent_def_archived",
    target: key,
    before: { version: current.version, agentStatus: current.agentStatus },
    after: { version: archived.version, agentStatus: archived.agentStatus },
  });

  return Response.json({ ok: true, agentDef: archived });
}
