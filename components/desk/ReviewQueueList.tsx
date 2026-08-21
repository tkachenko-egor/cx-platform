"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface ReviewQueueItem {
  id: string;
  conversationId: string;
  reason: string;
  /** Pre-formatted server-side — a client component reformatting a raw timestamp itself would recompute it with the browser's locale during hydration, mismatching the server-rendered HTML. */
  flaggedAt: string;
}

/** Phase 2 M5: staff-side decide/dismiss for the human review queue (a review tier distinct from escalation). */
export function ReviewQueueList({ items }: { items: ReviewQueueItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return <p className="mt-8 text-sm text-muted">Nothing pending review.</p>;

  const decide = async (id: string, decision: "reviewed" | "dismissed") => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/desk/review-queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not record decision");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-6 space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="flex items-center justify-between">
            <Link href={`/desk/${item.conversationId}`} className="font-medium text-fg hover:underline">
              {item.conversationId}
            </Link>
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted">{item.reason}</span>
          </div>
          <p className="mt-1 text-xs text-muted">flagged {item.flaggedAt}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => decide(item.id, "reviewed")}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
            >
              Mark reviewed
            </button>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => decide(item.id, "dismissed")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
