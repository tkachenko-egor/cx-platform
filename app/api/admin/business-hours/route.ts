import { getPlatformContext, invalidatePlatformContext } from "../../../../src/platform/context";
import { TenantRepository, type WeeklyHoursRule } from "../../../../src/db/repositories/tenant-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 9 M3: the weekly-hours editor at /admin/business-hours posts here. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; weeklyHours?: WeeklyHoursRule[] };

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  new TenantRepository(db).updateBusinessHours(tenant.id, { enabled: Boolean(body.enabled), weeklyHours: body.weeklyHours ?? [] });
  // See app/api/admin/alert-thresholds/route.ts's comment — same per-slug cache staleness issue.
  invalidatePlatformContext(tenant.slug);
  new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "business_hours_updated", target: tenant.id });

  return Response.json({ ok: true });
}
