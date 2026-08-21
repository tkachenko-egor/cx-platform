import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformContext } from "../../src/platform/context";
import { getSessionUser } from "../../src/auth/session";
import { roleAtLeast } from "../../src/auth/permissions";
import { SignOutButton } from "../../components/desk/SignOutButton";

export const dynamic = "force-dynamic";

const NAV_LINKS = [
  { href: "/admin/agents", label: "Agents" },
  { href: "/admin/models", label: "Models" },
  { href: "/admin/tools", label: "Tools" },
  { href: "/admin/kb", label: "Knowledge base" },
  { href: "/analytics", label: "Analytics" },
  { href: "/admin/api-keys", label: "API Keys" },
  { href: "/admin/team", label: "Team" },
  { href: "/admin/audit-log", label: "Audit log" },
  { href: "/admin/experiments", label: "Experiments" },
];

/** Phase 3 M3: shared admin shell — auth/role gate + nav, so individual admin pages only own their own content. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");
  if (!roleAtLeast(user.role, "admin")) redirect("/desk");

  return (
    <div>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-muted hover:text-fg">
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="flex items-center gap-2 text-xs text-muted">
            {user.email} · {user.role}
            <SignOutButton />
          </p>
        </div>
      </header>
      {children}
    </div>
  );
}
