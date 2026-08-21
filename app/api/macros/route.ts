import { getPlatformContext } from "../../../src/platform/context";
import { MacroRepository } from "../../../src/db/repositories/macro-repository";
import { requireRole, AuthError } from "../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 2 M8: list macros, optionally filtered by the composer's typeahead query. */
export async function GET(req: Request) {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const query = new URL(req.url).searchParams.get("q");
  const macros = new MacroRepository(db, tenant);
  return Response.json({ macros: query ? macros.search(query) : macros.list() });
}

/** Phase 2 M8: create a macro — same reply_as_human bar as sending a reply (app/api/desk/[conversationId]/reply/route.ts). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; body?: string; tags?: string[] };
  const name = body.name?.trim();
  const text = body.body?.trim();
  if (!name || !text) return Response.json({ error: "name and body are required" }, { status: 400 });

  const { db, tenant } = await getPlatformContext();
  let staffUser;
  try {
    staffUser = await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const macro = new MacroRepository(db, tenant).create({ name, body: text, tags: body.tags, createdBy: staffUser.id });
  return Response.json({ ok: true, macro });
}
