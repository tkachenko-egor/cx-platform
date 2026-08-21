"use client";

import Link from "next/link";

export interface TabItem {
  href: string;
  label: string;
  /** e.g. Analytics/Widget on a not-yet-created agent — nothing to link to yet. */
  disabled?: boolean;
}

/** Phase 6 M7: first Tabs primitive in this codebase — link-based (each tab is its own route/server component), no client-state data-fetching merge. */
export function Tabs({ items, active }: { items: TabItem[]; active: string }) {
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {items.map((item) => {
        const isActive = item.href === active;
        if (item.disabled) {
          return (
            <span key={item.label} title="Not available until this agent is created" className="cursor-not-allowed border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted/50">
              {item.label}
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
