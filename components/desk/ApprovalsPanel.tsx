"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

export interface PendingApproval {
  id: string;
  toolKey: string;
  arguments: Record<string, unknown>;
}

/** FR-8.5: the desk-side half of require_human_approval — approve/deny a parked write-tool call. */
export function ApprovalsPanel({ conversationId, approvals }: { conversationId: string; approvals: PendingApproval[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (approvals.length === 0) return null;

  const decide = async (approvalId: string, decision: "approve" | "deny") => {
    setBusyId(approvalId);
    setError(null);
    try {
      const res = await fetch(`/api/desk/${conversationId}/approvals/${approvalId}`, {
        method: "POST",
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
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-fg">Pending approvals</h2>
      <div className="mt-3 space-y-2">
        {approvals.map((a) => (
          <Card key={a.id} className="border-warning/40 p-4">
            <p className="font-medium text-fg">{a.toolKey}</p>
            <pre className="mt-1 whitespace-pre-wrap text-xs text-muted">{JSON.stringify(a.arguments)}</pre>
            <div className="mt-3 flex gap-2">
              <Button disabled={busyId === a.id} onClick={() => decide(a.id, "approve")} className="px-3 py-1.5 text-xs">
                Approve
              </Button>
              <Button variant="secondary" disabled={busyId === a.id} onClick={() => decide(a.id, "deny")} className="px-3 py-1.5 text-xs">
                Deny
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}
