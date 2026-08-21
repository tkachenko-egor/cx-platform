"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      <h2 className="text-sm font-medium text-muted">Pending approvals</h2>
      <div className="mt-2 space-y-2">
        {approvals.map((a) => (
          <div key={a.id} className="rounded-lg border border-warning/40 bg-surface p-3 text-sm">
            <p className="font-medium text-fg">{a.toolKey}</p>
            <pre className="mt-1 whitespace-pre-wrap text-xs text-muted">{JSON.stringify(a.arguments)}</pre>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busyId === a.id}
                onClick={() => decide(a.id, "approve")}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId === a.id}
                onClick={() => decide(a.id, "deny")}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}
