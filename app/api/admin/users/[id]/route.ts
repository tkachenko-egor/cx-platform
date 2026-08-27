import { getPlatformContext } from "../../../../../src/platform/context";
import { UserRepository } from "../../../../../src/db/repositories/user-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import type { Role } from "../../../../../src/auth/permissions";

export const runtime = "nodejs";

const VALID_ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];

/** Phase 3 M3: role reassignment / deactivation — the first real consumer of the manage_users permission. */
export async function PATCH(req: Request, context: RouteContext<"/api/admin/users/[id]">) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { role?: string; status?: string };
  if (body.role !== undefined && !VALID_ROLES.includes(body.role as Role)) {
    return Response.json({ error: `role must be one of ${VALID_ROLES.join(", ")}` }, { status: 400 });
  }
  if (body.status !== undefined && body.status !== "active" && body.status !== "disabled") {
    return Response.json({ error: "status must be 'active' or 'disabled'" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const users = new UserRepository(db, tenant);
  const before = await users.get(id);
  if (!before) return Response.json({ error: "User not found" }, { status: 404 });

  const updated = await users.update(id, { role: body.role as Role | undefined, status: body.status as "active" | "disabled" | undefined });

  await new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: body.status === "disabled" ? "user_deactivated" : "user_role_changed",
    target: id,
    before: { role: before.role, status: before.status },
    after: { role: updated?.role, status: updated?.status },
  });

  return Response.json({ ok: true, user: updated });
}
