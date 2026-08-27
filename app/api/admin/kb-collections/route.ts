import { getPlatformContext } from "../../../../src/platform/context";
import { KbCollectionRepository } from "../../../../src/db/repositories/kb-collection-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

export async function GET() {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const collections = new KbCollectionRepository(db, tenant);
  const withCounts = await Promise.all((await collections.list()).map(async (c) => ({ ...c, articleCount: await collections.countArticles(c.id) })));
  return Response.json({ collections: withCounts });
}

/** Phase 5 M2: Knowledge Bases had no admin surface before this — KB content was one flat, ungrouped list. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string };
  if (!body.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const collection = await new KbCollectionRepository(db, tenant).create({ name: body.name.trim(), description: body.description?.trim() });

  new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "kb_collection_created", target: collection.id, after: { name: collection.name } });

  return Response.json({ ok: true, collection: { ...collection, articleCount: 0 } });
}
