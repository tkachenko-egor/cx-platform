import { getPlatformContext } from "../../../../../../src/platform/context";
import { ToolApprovalRepository } from "../../../../../../src/db/repositories/tool-approval-repository";
import { AuditLogRepository } from "../../../../../../src/db/repositories/audit-log-repository";
import { executeApprovedTool } from "../../../../../../src/tools/registry";
import { requireRole, AuthError } from "../../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** FR-8.5: staff approve or deny a write-tool call parked behind require_human_approval. */
export async function POST(req: Request, context: RouteContext<"/api/desk/[conversationId]/approvals/[approvalId]">) {
  const { conversationId, approvalId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { decision?: "approve" | "deny" };
  if (body.decision !== "approve" && body.decision !== "deny") {
    return Response.json({ error: "decision must be 'approve' or 'deny'" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let staffUser;
  try {
    staffUser = await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const approvals = new ToolApprovalRepository(db, tenant);
  const approval = approvals.get(approvalId);
  if (!approval || approval.conversationId !== conversationId) return Response.json({ error: "Approval not found" }, { status: 404 });
  if (approval.status !== "pending") return Response.json({ error: `Already ${approval.status}` }, { status: 409 });

  const audit = new AuditLogRepository(db, tenant);

  if (body.decision === "deny") {
    approvals.markDecided(approval.id, "denied", staffUser.id);
    audit.record({ actorUserId: staffUser.id, action: "tool_approval_denied", target: approval.id, after: { toolKey: approval.toolKey } });
    return Response.json({ ok: true, status: "denied" });
  }

  const result = await executeApprovedTool(db, tenant, approval);
  approvals.markDecided(approval.id, "approved", staffUser.id);
  audit.record({ actorUserId: staffUser.id, action: "tool_approval_approved", target: approval.id, before: { toolKey: approval.toolKey }, after: { result } });

  return Response.json({ ok: true, status: "approved", result });
}
