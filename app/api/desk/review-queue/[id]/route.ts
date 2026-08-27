import { getPlatformContext } from "../../../../../src/platform/context";
import { ReviewQueueRepository } from "../../../../../src/db/repositories/review-queue-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 2 M5: staff mark a review-queue item reviewed or dismissed. */
export async function PATCH(req: Request, context: RouteContext<"/api/desk/review-queue/[id]">) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { decision?: "reviewed" | "dismissed" };
  if (body.decision !== "reviewed" && body.decision !== "dismissed") {
    return Response.json({ error: "decision must be 'reviewed' or 'dismissed'" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let staffUser;
  try {
    staffUser = await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const reviewQueue = new ReviewQueueRepository(db, tenant);
  const entry = await reviewQueue.get(id);
  if (!entry) return Response.json({ error: "Review item not found" }, { status: 404 });
  if (entry.status !== "pending") return Response.json({ error: `Already ${entry.status}` }, { status: 409 });

  await reviewQueue.markDecided(entry.id, body.decision, staffUser.id);
  return Response.json({ ok: true, status: body.decision });
}
