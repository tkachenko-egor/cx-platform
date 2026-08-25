import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPlatformContext } from "../../src/platform/context";
import { getSessionUser } from "../../src/auth/session";
import { loginRedirectPath } from "../../src/auth/login-redirect";
import { roleAtLeast } from "../../src/auth/permissions";
import { AdminSidebar } from "../../components/admin/AdminSidebar";

export const dynamic = "force-dynamic";

/** Mirrors app/admin/layout.tsx — /analytics predates the Phase 4 sidebar and lived outside it, so it rendered with no nav chrome at all. */
export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect(await loginRedirectPath());
  if (!roleAtLeast(user.role, "admin")) redirect("/desk");

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <AdminSidebar email={user.email} role={user.role} />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
