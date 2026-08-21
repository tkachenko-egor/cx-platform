import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPlatformContext } from "../../src/platform/context";
import { getSessionUser } from "../../src/auth/session";
import { roleAtLeast } from "../../src/auth/permissions";
import { AdminSidebar } from "../../components/admin/AdminSidebar";

export const dynamic = "force-dynamic";

/** Phase 3 M3, redesigned in the Phase 4 design pass: shared admin shell — auth/role gate + sidebar nav, so individual admin pages only own their own content. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");
  if (!roleAtLeast(user.role, "admin")) redirect("/desk");

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminSidebar email={user.email} role={user.role} />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
