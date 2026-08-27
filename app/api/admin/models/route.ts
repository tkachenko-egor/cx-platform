import { getPlatformContext } from "../../../../src/platform/context";
import { ModelAliasRepository, type FallbackTarget } from "../../../../src/db/repositories/model-alias-repository";
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

  const aliases = await new ModelAliasRepository(db, tenant).list();
  return Response.json({ aliases });
}

/** Phase 4 M1: model_aliases had no admin UI before this — an agent's model was a hand-typed alias string with no way to see or create what it pointed to. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    alias?: string;
    provider?: string;
    model?: string;
    fallbackChain?: FallbackTarget[];
  };
  if (!body.alias?.trim() || !body.provider?.trim() || !body.model?.trim()) {
    return Response.json({ error: "alias, provider, and model are required" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const modelAliases = new ModelAliasRepository(db, tenant);
  const existing = await modelAliases.getByAlias(body.alias.trim());
  // Phase 7 M2 fix: an edit that doesn't touch the fallback chain must not
  // silently wipe one set elsewhere — carry the existing chain forward when
  // the request body omits the field entirely.
  const fallbackChain = body.fallbackChain ?? existing?.fallbackChain ?? [];
  const alias = await modelAliases.upsert({ alias: body.alias.trim(), provider: body.provider.trim(), model: body.model.trim(), fallbackChain });

  await new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: existing ? "model_alias_updated" : "model_alias_created",
    target: alias.alias,
    before: existing ? { provider: existing.provider, model: existing.model, fallbackChain: existing.fallbackChain } : undefined,
    after: { provider: alias.provider, model: alias.model, fallbackChain: alias.fallbackChain },
  });

  return Response.json({ ok: true, alias });
}
