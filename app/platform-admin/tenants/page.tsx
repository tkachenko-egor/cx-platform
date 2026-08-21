import { redirect } from "next/navigation";
import { getDb } from "../../../src/db/client";
import { getPlatformAdminSessionUser } from "../../../src/auth/platform-admin-lookup";
import { TenantRepository } from "../../../src/db/repositories/tenant-repository";
import { SignOutButton } from "../../../components/desk/SignOutButton";
import { TenantManagement } from "../../../components/admin/TenantManagement";

export const dynamic = "force-dynamic";

/** Phase 3 M4: cross-tenant tenant management — gated by getPlatformAdminSessionUser(), not getPlatformContext()/requireRole (no single tenant applies here). */
export default async function PlatformAdminTenantsPage() {
  const db = getDb();
  const found = await getPlatformAdminSessionUser(db);
  if (!found) redirect("/login");

  const tenants = new TenantRepository(db).list();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Tenants</h1>
        <p className="flex items-center gap-2 text-xs text-muted">
          {found.user.email} · platform admin
          <SignOutButton endpoint="/api/platform-admin/auth/logout" redirectTo="/login" />
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">Create and manage tenants across the platform.</p>

      <TenantManagement tenants={tenants.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))} />
    </main>
  );
}
