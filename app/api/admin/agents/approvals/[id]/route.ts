import { getPlatformContext } from "../../../../../../src/platform/context";
import { AgentDefRepository } from "../../../../../../src/db/repositories/agent-def-repository";
import { AgentPublishApprovalRepository } from "../../../../../../src/db/repositories/agent-publish-approval-repository";
import { AuditLogRepository } from "../../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 8 M3: admin/owner approves or rejects a supervisor's pending live-publish request — same shape as app/api/desk/review-queue/[id]/route.ts. */
export async function PATCH(req: Request, context: RouteContext<"/api/admin/agents/approvals/[id]">) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { decision?: "approved" | "rejected" };
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return Response.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const approvals = new AgentPublishApprovalRepository(db, tenant);
  const approval = approvals.get(id);
  if (!approval) return Response.json({ error: "Approval request not found" }, { status: 404 });
  if (approval.status !== "pending") return Response.json({ error: `Already ${approval.status}` }, { status: 409 });

  if (body.decision === "rejected") {
    approvals.markDecided(approval.id, "rejected", actor.id);
    new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "agent_publish_rejected", target: approval.agentKey, before: { approvalId: approval.id } });
    return Response.json({ ok: true, status: "rejected" });
  }

  // Replays the requester's payload verbatim — the approver isn't re-deriving
  // it from whatever the editor happens to show now, which may have moved on.
  const published = new AgentDefRepository(db, tenant).publish(approval.payload as Parameters<AgentDefRepository["publish"]>[0]);
  approvals.markDecided(approval.id, "approved", actor.id);
  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "agent_publish_approved",
    target: approval.agentKey,
    before: { approvalId: approval.id },
    after: { version: published.version, agentStatus: published.agentStatus, environment: published.environment },
  });

  return Response.json({ ok: true, status: "approved", agentDef: published });
}
