import { getPlatformContext } from "../../../../src/platform/context";
import { MacroRepository } from "../../../../src/db/repositories/macro-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Phase 2 M8: edit a macro's name/body/tags. */
export async function PATCH(req: Request, context: RouteContext<"/api/macros/[macroId]">) {
  const { macroId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; body?: string; tags?: string[] };

  const { db, tenant } = getPlatformContext();
  try {
    await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const macros = new MacroRepository(db, tenant);
  const existing = macros.get(macroId);
  if (!existing) return Response.json({ error: "Macro not found" }, { status: 404 });

  macros.update(macroId, { name: body.name?.trim() || undefined, body: body.body?.trim() || undefined, tags: body.tags });
  return Response.json({ ok: true, macro: macros.get(macroId) });
}

/** Phase 2 M8: delete a macro. */
export async function DELETE(_req: Request, context: RouteContext<"/api/macros/[macroId]">) {
  const { macroId } = await context.params;

  const { db, tenant } = getPlatformContext();
  try {
    await requireRole(db, tenant, "agent");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const macros = new MacroRepository(db, tenant);
  const existing = macros.get(macroId);
  if (!existing) return Response.json({ error: "Macro not found" }, { status: 404 });

  macros.delete(macroId);
  return Response.json({ ok: true });
}
