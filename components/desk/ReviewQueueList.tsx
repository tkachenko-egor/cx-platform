"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

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
    <div className="mt-6 space-y-3">
      {items.map((item) => (
        <Card key={item.id} className="p-4">
          <div className="flex items-center justify-between">
            <Link href={`/desk/${item.conversationId}`} className="font-medium text-fg hover:underline">
              {item.conversationId}
            </Link>
            <Badge>{item.reason}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">flagged {item.flaggedAt}</p>
          <div className="mt-3 flex gap-2">
            <Button disabled={busyId === item.id} onClick={() => decide(item.id, "reviewed")} className="px-3 py-1.5 text-xs">
              Mark reviewed
            </Button>
            <Button variant="secondary" disabled={busyId === item.id} onClick={() => decide(item.id, "dismissed")} className="px-3 py-1.5 text-xs">
              Dismiss
            </Button>
          </div>
        </Card>
      ))}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
