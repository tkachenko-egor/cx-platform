import { getPlatformContext } from "../../../../../src/platform/context";
import { AutoTagRuleRepository } from "../../../../../src/db/repositories/auto-tag-rule-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/tag-rules/[id]">) {
  const { id } = await ctx.params;
  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  await new AutoTagRuleRepository(db, tenant).delete(id);
  await new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "auto_tag_rule_deleted", target: id });

  return Response.json({ ok: true });
}
