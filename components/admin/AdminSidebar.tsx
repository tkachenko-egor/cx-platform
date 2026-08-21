"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Cpu,
  Wrench,
  BookOpen,
  BarChart3,
  KeyRound,
  Users,
  History,
  FlaskConical,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { SignOutButton } from "../desk/SignOutButton";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const BUILD_ITEMS: NavItem[] = [
  { href: "/admin/agents", label: "Agents", icon: Bot },
  { href: "/admin/models", label: "Models", icon: Cpu },
  { href: "/admin/tools", label: "Tools", icon: Wrench },
  { href: "/admin/kb", label: "Knowledge base", icon: BookOpen },
];

const OPERATE_ITEMS: NavItem[] = [
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/api-keys", label: "API keys", icon: KeyRound },
  { href: "/admin/team", label: "Team", icon: Users },
  { href: "/admin/audit-log", label: "Audit log", icon: History },
  { href: "/admin/experiments", label: "Experiments", icon: FlaskConical },
];

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "bg-sidebar-active text-sidebar-fg-active" : "text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg-active"
      }`}
    >
      <Icon size={16} strokeWidth={2} />
      {item.label}
    </Link>
  );
}

/** Phase 4 design refresh: dark icon-led sidebar replacing the cramped top-nav bar — see app/admin/layout.tsx for the server-side auth gate this wraps. */
export function AdminSidebar({ email, role }: { email: string; role: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || (href !== "/admin/agents" && pathname?.startsWith(href + "/"));

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg">CX</div>
        <span className="text-sm font-semibold tracking-tight text-sidebar-fg-active">CX Platform</span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        <div>
          <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-fg/60">Build</p>
          <div className="space-y-0.5">
            {BUILD_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} active={Boolean(isActive(item.href))} />
            ))}
          </div>
        </div>
        <div>
          <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-fg/60">Operate</p>
          <div className="space-y-0.5">
            {OPERATE_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} active={Boolean(isActive(item.href))} />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <Link href="/desk" className="mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-fg transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg-active">
          <MessageSquare size={16} strokeWidth={2} />
          Human desk
        </Link>
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-hover text-[11px] font-medium text-sidebar-fg-active">{initials(email)}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-sidebar-fg-active">{email}</p>
            <p className="text-[11px] text-sidebar-fg/70">{role}</p>
          </div>
          <SignOutButton className="text-[11px] text-sidebar-fg/70 hover:text-sidebar-fg-active" />
        </div>
      </div>
    </aside>
  );
}
