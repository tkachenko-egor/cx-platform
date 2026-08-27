import { getPlatformContext, invalidatePlatformContext } from "../../../../../src/platform/context";
import { ProviderCredentialRepository } from "../../../../../src/db/repositories/provider-credential-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";

export const runtime = "nodejs";

/** Deactivates a provider credential (LLM key or tool-integration key) — never a hard delete, so audit history still resolves it. */
export async function DELETE(_req: Request, context: RouteContext<"/api/admin/api-keys/[id]">) {
  const { id } = await context.params;
  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const credentials = new ProviderCredentialRepository(db, tenant);
  const existing = (await credentials.list()).find((c) => c.id === id);
  if (!existing) return Response.json({ error: "Credential not found" }, { status: 404 });

  await credentials.deactivate(id);

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "provider_credential_deactivated",
    target: existing.provider,
    before: { credentialId: existing.id, label: existing.label },
  });

  if (existing.kind === "llm_provider") {
    invalidatePlatformContext(tenant.slug);
  }

  return Response.json({ ok: true });
}
