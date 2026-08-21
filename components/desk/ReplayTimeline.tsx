"use client";

import { useState } from "react";

export interface ReplayItem {
  id: string;
  kind: "message" | "event";
  /** Pre-formatted server-side (see ReviewQueueList's note) to avoid a locale-dependent hydration mismatch. */
  time: string;
  /** Message role, or event type — used for the label pill. */
  label: string;
  detail: string;
  dimmed?: boolean;
}

/** Phase 2 M7b: scrubs through a conversation's messages + events merged chronologically, no new schema/repository — pure UI composition of two existing read paths. */
export function ReplayTimeline({ items }: { items: ReplayItem[] }) {
  const [cursor, setCursor] = useState(items.length - 1);

  if (items.length === 0) return <p className="mt-8 text-sm text-muted">Nothing to replay yet.</p>;

  const visible = items.slice(0, cursor + 1);
  const current = items[cursor];

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={items.length - 1}
          value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <span className="whitespace-nowrap text-xs text-muted">
          {cursor + 1} / {items.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{current.time}</p>

      <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface p-4">
        {visible.map((item, i) => (
          <div key={item.id} className={`rounded-lg p-2 text-sm ${i === cursor ? "bg-accent/10 ring-1 ring-accent" : ""}`}>
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
              <span className={item.kind === "event" ? "rounded border border-border px-1 py-0.5" : ""}>{item.label}</span>
              <span className="normal-case">{item.time}</span>
            </p>
            <p className={`whitespace-pre-wrap text-fg ${item.dimmed ? "opacity-60" : ""} ${item.kind === "event" ? "text-xs text-muted" : "text-sm"}`}>{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
