"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

export interface AgentApprovalItem {
  id: string;
  agentKey: string;
  requestedByEmail: string;
  requestedVersion: number;
  fromStatus: string;
  toStatus: string;
  fromEnvironment: string;
  toEnvironment: string;
  /** Pre-formatted server-side, same reasoning as ReviewQueueList's flaggedAt. */
  requestedAt: string;
}

/** Phase 8 M3: admin/owner review for a supervisor's attempt to publish an agent live — same shape as components/desk/ReviewQueueList.tsx. */
export function AgentApprovalsList({ items }: { items: AgentApprovalItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return <p className="mt-8 text-sm text-muted">No agent publish requests waiting on approval.</p>;

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/agents/approvals/${id}`, {
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
            <Link href={`/admin/agents/${item.agentKey}`} className="font-medium text-fg hover:underline">
              {item.agentKey}
            </Link>
            <span className="text-xs text-muted">v{item.requestedVersion}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge>
              {item.fromStatus} → {item.toStatus}
            </Badge>
            <Badge>
              {item.fromEnvironment} → {item.toEnvironment}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted">
            requested by {item.requestedByEmail} · {item.requestedAt}
          </p>
          <div className="mt-3 flex gap-2">
            <Button disabled={busyId === item.id} onClick={() => decide(item.id, "approved")} className="px-3 py-1.5 text-xs">
              Approve
            </Button>
            <Button variant="secondary" disabled={busyId === item.id} onClick={() => decide(item.id, "rejected")} className="px-3 py-1.5 text-xs">
              Reject
            </Button>
          </div>
        </Card>
      ))}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
