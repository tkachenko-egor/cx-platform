import { getPlatformContext, invalidatePlatformContext } from "../../../../src/platform/context";
import { ProviderCredentialRepository } from "../../../../src/db/repositories/provider-credential-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

const VALID_PROVIDERS = ["anthropic", "openai"] as const;

export async function GET() {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const credentials = await new ProviderCredentialRepository(db, tenant).list();
  return Response.json({ credentials });
}

/** Sets the tenant's active LLM provider key — attributed to the requesting admin (owner_user_id). Never returns the plaintext key back. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { provider?: string; label?: string; plaintextKey?: string };
  if (!body.provider || !(VALID_PROVIDERS as readonly string[]).includes(body.provider)) {
    return Response.json({ error: `provider must be one of ${VALID_PROVIDERS.join(", ")}` }, { status: 400 });
  }
  if (!body.label?.trim() || !body.plaintextKey?.trim()) {
    return Response.json({ error: "label and plaintextKey are required" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const credential = await new ProviderCredentialRepository(db, tenant).setActiveLlmKey({
    provider: body.provider as "anthropic" | "openai",
    label: body.label.trim(),
    plaintextKey: body.plaintextKey.trim(),
    ownerUserId: actor.id,
  });

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "provider_credential_set",
    target: credential.provider,
    after: { credentialId: credential.id, label: credential.label, keyLast4: credential.keyLast4 },
  });

  invalidatePlatformContext(tenant.slug);

  return Response.json({ ok: true, credential });
}
