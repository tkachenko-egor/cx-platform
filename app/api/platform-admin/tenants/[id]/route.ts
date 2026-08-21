import { getDb } from "../../../../../src/db/client";
import { getPlatformAdminSessionUser } from "../../../../../src/auth/platform-admin-lookup";
import { TenantRepository } from "../../../../../src/db/repositories/tenant-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { RESERVED_SUBDOMAINS } from "../../../../../src/platform/reserved-subdomains";

export const runtime = "nodejs";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export async function PATCH(req: Request, context: RouteContext<"/api/platform-admin/tenants/[id]">) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; slug?: string };
  const name = body.name?.trim();
  const slug = body.slug?.trim().toLowerCase();
  if (slug !== undefined && (!SLUG_PATTERN.test(slug) || RESERVED_SUBDOMAINS.has(slug))) {
    return Response.json({ error: "slug must be lowercase/hyphenated and not a reserved subdomain" }, { status: 400 });
  }

  const db = getDb();
  const found = await getPlatformAdminSessionUser(db);
  if (!found) return Response.json({ error: "Authentication required" }, { status: 401 });

  const tenants = new TenantRepository(db);
  const before = tenants.getById(id);
  if (!before) return Response.json({ error: "Tenant not found" }, { status: 404 });

  try {
    const updated = tenants.update(id, { name: name || undefined, slug: slug || undefined });
    new AuditLogRepository(db, found.tenant).record({
      actorUserId: found.user.id,
      action: "tenant_updated",
      target: id,
      before: { name: before.name, slug: before.slug },
      after: { name: updated.name, slug: updated.slug },
    });
    return Response.json({ ok: true, tenant: updated });
  } catch {
    return Response.json({ error: "A tenant with that slug already exists" }, { status: 409 });
  }
}
