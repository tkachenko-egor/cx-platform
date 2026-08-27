import { getPlatformContext, invalidatePlatformContext } from "../../../../src/platform/context";
import { TenantRepository } from "../../../../src/db/repositories/tenant-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 9 M4: the inline threshold editor on /analytics posts here. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { maxHandoffRatePct?: number | null; minCsatScore?: number | null };

  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  await new TenantRepository(db).updateAlertThresholds(tenant.id, {
    maxHandoffRatePct: body.maxHandoffRatePct ?? undefined,
    minCsatScore: body.minCsatScore ?? undefined,
  });
  // getPlatformContext() caches the resolved Tenant object per-slug for the
  // life of the process (src/platform/context.ts) — without this, every
  // page read through it keeps seeing the pre-update thresholds.
  invalidatePlatformContext(tenant.slug);

  return Response.json({ ok: true });
}
