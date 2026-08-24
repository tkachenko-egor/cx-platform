"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { Badge } from "../ui/Badge";

export interface ActiveAlertRow {
  label: string;
  detail: string;
}

/** Phase 9 M4: active alerts (breached thresholds) plus the inline editor for setting them — admin+-only, shown to viewers/agents as a read-only alerts list if any are active. */
export function AlertThresholdsCard({
  activeAlerts,
  maxHandoffRatePct,
  minCsatScore,
  canEdit,
}: {
  activeAlerts: ActiveAlertRow[];
  maxHandoffRatePct: number | null;
  minCsatScore: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [maxHandoff, setMaxHandoff] = useState(maxHandoffRatePct != null ? String(maxHandoffRatePct) : "");
  const [minCsat, setMinCsat] = useState(minCsatScore != null ? String(minCsatScore) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/alert-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxHandoffRatePct: maxHandoff.trim() ? Number(maxHandoff) : null,
          minCsatScore: minCsat.trim() ? Number(minCsat) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save thresholds");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (activeAlerts.length === 0 && !canEdit) return null;

  return (
    <Card className="mb-6 p-6">
      <div className="flex items-center gap-2">
        <AlertOctagon size={14} className="text-muted" />
        <h2 className="text-sm font-semibold text-fg">Alerts</h2>
      </div>
      {activeAlerts.length > 0 ? (
        <div className="mt-3 space-y-2">
          {activeAlerts.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <Badge variant="warning">{a.label}</Badge>
              <span className="text-xs text-muted">{a.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Nothing breaching a configured threshold right now.</p>
      )}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <Field label="Max handoff rate (%)" htmlFor="alert-max-handoff">
            <Input id="alert-max-handoff" type="number" min={0} max={100} value={maxHandoff} onChange={(e) => setMaxHandoff(e.target.value)} placeholder="Off" className="w-32" />
          </Field>
          <Field label="Min CSAT (%)" htmlFor="alert-min-csat">
            <Input id="alert-min-csat" type="number" min={0} max={100} value={minCsat} onChange={(e) => setMinCsat(e.target.value)} placeholder="Off" className="w-32" />
          </Field>
          <Button type="button" variant="secondary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save thresholds"}
          </Button>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </Card>
  );
}
