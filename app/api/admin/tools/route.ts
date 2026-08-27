import { getPlatformContext } from "../../../../src/platform/context";
import { ToolDefRepository } from "../../../../src/db/repositories/tool-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";
import { parseHttpToolConfig } from "../../../../src/tools/http-tool-executor";
import type { ApprovalPolicy } from "../../../../src/db/repositories/tool-repository";

export const runtime = "nodejs";

const VALID_APPROVAL_POLICIES: ApprovalPolicy[] = ["auto", "confirm_with_customer", "require_human_approval"];

export async function GET() {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const tools = await new ToolDefRepository(db, tenant).list();
  return Response.json({ tools });
}

/**
 * Phase 3 M7: creates/updates an admin-authored HTTP tool — no code handler
 * or redeploy needed (see src/tools/http-tool-executor.ts).
 *
 * Creating a tool takes a displayName and derives the key server-side; a
 * client-supplied key is only ever honoured as the target of an *update*,
 * since the key is referenced by agent_defs.tool_ids, tool_calls rows and
 * write-tool idempotency keys and must survive a rename.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    key?: string;
    displayName?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    writeFlag?: boolean;
    approvalPolicy?: ApprovalPolicy;
    handlerConfig?: Record<string, unknown>;
  };
  const suppliedKey = body.key?.trim();
  const displayName = body.displayName?.trim();
  if ((!suppliedKey && !displayName) || !body.description?.trim() || !body.inputSchema) {
    return Response.json({ error: "displayName, description, and inputSchema are required" }, { status: 400 });
  }
  const approvalPolicy = body.approvalPolicy ?? "auto";
  if (!VALID_APPROVAL_POLICIES.includes(approvalPolicy)) {
    return Response.json({ error: `approvalPolicy must be one of ${VALID_APPROVAL_POLICIES.join(", ")}` }, { status: 400 });
  }

  // Server-side validation of the request config — never trust the client's JSON as-is.
  let handlerConfig;
  try {
    handlerConfig = parseHttpToolConfig(body.handlerConfig ?? {});
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const toolDefs = new ToolDefRepository(db, tenant);
  const existing = suppliedKey ? await toolDefs.getByKey(suppliedKey) : undefined;
  if (existing && existing.type !== "http") {
    return Response.json({ error: `"${existing.key}" is a code tool and can't be edited here` }, { status: 400 });
  }

  // Update keeps the existing key; create derives one from the name.
  const key = existing ? existing.key : await toolDefs.generateUniqueKey(displayName ?? suppliedKey ?? "");

  const tool = await toolDefs.upsert({
    key,
    displayName: displayName || existing?.displayName || key,
    description: body.description.trim(),
    inputSchema: body.inputSchema,
    writeFlag: Boolean(body.writeFlag),
    approvalPolicy,
    type: "http",
    handlerConfig: handlerConfig as unknown as Record<string, unknown>,
  });

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: existing ? "tool_def_updated" : "tool_def_created",
    target: tool.key,
    before: existing ? { displayName: existing.displayName, description: existing.description, writeFlag: existing.writeFlag, approvalPolicy: existing.approvalPolicy } : undefined,
    after: { displayName: tool.displayName, description: tool.description, writeFlag: tool.writeFlag, approvalPolicy: tool.approvalPolicy },
  });

  return Response.json({ ok: true, tool });
}
