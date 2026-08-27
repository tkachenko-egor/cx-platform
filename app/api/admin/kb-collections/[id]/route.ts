import { getPlatformContext } from "../../../../../src/platform/context";
import { KbCollectionRepository } from "../../../../../src/db/repositories/kb-collection-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Blocked (see KbCollectionRepository.delete) if the collection still has articles — no cascade/reassign UI this round. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/kb-collections/[id]">) {
  const { id } = await ctx.params;
  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const collections = new KbCollectionRepository(db, tenant);
  const existing = await collections.getById(id);
  if (!existing) return Response.json({ error: "Knowledge Base not found" }, { status: 404 });

  const result = await collections.delete(id);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "kb_collection_deleted", target: id, before: { name: existing.name } });

  return Response.json({ ok: true });
}
