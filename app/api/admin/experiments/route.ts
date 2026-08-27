import { getPlatformContext } from "../../../../src/platform/context";
import { AgentExperimentRepository } from "../../../../src/db/repositories/agent-experiment-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 2 M6a: create an A/B experiment for an agent key. manage_agents-gated (owner/admin). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agentKey?: string;
    variantAVersion?: number;
    variantBVersion?: number;
    trafficSplit?: number;
  };
  if (!body.agentKey || typeof body.variantAVersion !== "number" || typeof body.variantBVersion !== "number" || typeof body.trafficSplit !== "number") {
    return Response.json({ error: "agentKey, variantAVersion, variantBVersion, trafficSplit are required" }, { status: 400 });
  }
  if (body.trafficSplit < 0 || body.trafficSplit > 1) {
    return Response.json({ error: "trafficSplit must be between 0 and 1" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  try {
    const experiment = await new AgentExperimentRepository(db, tenant).create({
      agentKey: body.agentKey,
      variantAVersion: body.variantAVersion,
      variantBVersion: body.variantBVersion,
      trafficSplit: body.trafficSplit,
    });
    return Response.json({ ok: true, experiment });
  } catch {
    // Most likely idx_agent_experiments_one_active — an active experiment already exists for this key.
    return Response.json({ error: "An active experiment already exists for this agent key — stop it first." }, { status: 409 });
  }
}
