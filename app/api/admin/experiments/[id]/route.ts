import { getPlatformContext } from "../../../../../src/platform/context";
import { AgentExperimentRepository } from "../../../../../src/db/repositories/agent-experiment-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 2 M6a: stop a running experiment — new conversations fall back to getLatestPublished immediately. */
export async function PATCH(_req: Request, context: RouteContext<"/api/admin/experiments/[id]">) {
  const { id } = await context.params;
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  await new AgentExperimentRepository(db, tenant).stop(id);
  return Response.json({ ok: true });
}
