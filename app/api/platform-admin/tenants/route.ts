import { getDb } from "../../../../src/db/client";
import { getPlatformAdminSessionUser } from "../../../../src/auth/platform-admin-lookup";
import { TenantRepository } from "../../../../src/db/repositories/tenant-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { RESERVED_SUBDOMAINS } from "../../../../src/platform/reserved-subdomains";

export const runtime = "nodejs";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export async function GET() {
  const db = getDb();
  const found = await getPlatformAdminSessionUser(db);
  if (!found) return Response.json({ error: "Authentication required" }, { status: 401 });

  // The reserved "platform" tenant holds the platform owner account itself — infrastructure, not a company to manage.
  const tenants = (await new TenantRepository(db).list()).filter((t) => !RESERVED_SUBDOMAINS.has(t.slug));
  return Response.json({ tenants });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; slug?: string };
  const name = body.name?.trim();
  const slug = body.slug?.trim().toLowerCase();
  if (!name || !slug || !SLUG_PATTERN.test(slug)) {
    return Response.json({ error: "name and a lowercase, hyphenated slug are required" }, { status: 400 });
  }
  if (RESERVED_SUBDOMAINS.has(slug)) {
    return Response.json({ error: `"${slug}" is a reserved subdomain and can't be used as a tenant slug` }, { status: 400 });
  }

  const db = getDb();
  const found = await getPlatformAdminSessionUser(db);
  if (!found) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const tenant = await new TenantRepository(db).create(name, slug);
    await new AuditLogRepository(db, found.tenant).record({ actorUserId: found.user.id, action: "tenant_created", target: tenant.id, after: { name, slug } });
    return Response.json({ ok: true, tenant });
  } catch {
    return Response.json({ error: "A tenant with that slug already exists" }, { status: 409 });
  }
}
