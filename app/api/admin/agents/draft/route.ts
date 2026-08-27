import { getPlatformContext } from "../../../../../src/platform/context";
import { AgentDefRepository, type AgentDefWriteInput } from "../../../../../src/db/repositories/agent-def-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/**
 * Milestone 5 (Save/Publish split): saves the agent editor's current form
 * state into the mutable draft row (AgentDefRepository.saveDraft) without
 * publishing a new version or touching the live agent_status. Same
 * permission level as the main /api/admin/agents edit path — a supervisor
 * can freely save work-in-progress; only actually going live still needs
 * the approval gate there.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AgentDefWriteInput;
  if (!body.key || !body.systemPrompt || !body.modelAlias) {
    return Response.json({ error: "key, systemPrompt, and modelAlias are required" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "supervisor");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const draft = await new AgentDefRepository(db, tenant).saveDraft(body);
  return Response.json({ ok: true, agentDef: draft });
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return Response.json({ error: "key is required" }, { status: 400 });

  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "supervisor");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  await new AgentDefRepository(db, tenant).clearDraft(key);
  return Response.json({ ok: true });
}
