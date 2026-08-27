import { getPlatformContext } from "../../../../../src/platform/context";
import { ToolDefRepository } from "../../../../../src/db/repositories/tool-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Only 'http' tools have an admin lifecycle — 'code' tools are REGISTRY-defined and stay that way. */
export async function DELETE(_req: Request, context: RouteContext<"/api/admin/tools/[key]">) {
  const { key } = await context.params;
  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const toolDefs = new ToolDefRepository(db, tenant);
  const existing = await toolDefs.getByKey(key);
  if (!existing) return Response.json({ error: "Tool not found" }, { status: 404 });
  if (existing.type !== "http") return Response.json({ error: "Code tools can't be deleted here" }, { status: 400 });

  await toolDefs.delete(key);

  await new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "tool_def_deleted",
    target: key,
    before: { description: existing.description },
  });

  return Response.json({ ok: true });
}
