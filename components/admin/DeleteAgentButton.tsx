"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/** Milestone 5 (Archive = delete): agent_defs rows can never be truly deleted (FK'd from conversations/runs) — this archives instead, via DELETE /api/admin/agents/[key]. */
export function DeleteAgentButton({ agentKey }: { agentKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    if (!confirm(`Delete "${agentKey}"? This archives it — it stops being routable, but its history and past conversations are kept. You can restore it by publishing it again.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/agents/${agentKey}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Could not delete agent");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" disabled={busy} onClick={onDelete} aria-label={`Delete ${agentKey}`} title="Delete (archives)" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-danger disabled:opacity-50">
      <Trash2 size={14} />
    </button>
  );
}
