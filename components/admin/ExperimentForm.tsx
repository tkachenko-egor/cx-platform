"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { Badge } from "../ui/Badge";

export interface AgentVersionOption {
  key: string;
  version: number;
}

export interface ExperimentRow {
  id: string;
  agentKey: string;
  variantAVersion: number;
  variantBVersion: number;
  trafficSplit: number;
  status: "active" | "stopped";
}

/** Phase 2 M6a: minimal admin surface — publish/create is otherwise script/seed-driven today, so this is the first app/admin/ page. */
export function ExperimentForm({ agentVersions, experiments }: { agentVersions: AgentVersionOption[]; experiments: ExperimentRow[] }) {
  const router = useRouter();
  const keys = useMemo(() => [...new Set(agentVersions.map((v) => v.key))], [agentVersions]);
  const [agentKey, setAgentKey] = useState(keys[0] ?? "");
  const [variantAVersion, setVariantAVersion] = useState<number | "">("");
  const [variantBVersion, setVariantBVersion] = useState<number | "">("");
  const [trafficSplit, setTrafficSplit] = useState("0.5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const versionsForKey = agentVersions.filter((v) => v.key === agentKey);

  const create = async () => {
    setError(null);
    if (variantAVersion === "" || variantBVersion === "") {
      setError("Pick both variant versions");
      return;
    }
    // DA-06: a comma-decimal locale renders/accepts "0,5" in a native
    // <input type="number">, but the DOM value stays comma-separated on some
    // browsers (Firefox) — Number("0,5") is NaN, and that would silently
    // set an unusable traffic split rather than the 50% the admin typed.
    const normalizedSplit = Number(trafficSplit.replace(",", "."));
    if (!Number.isFinite(normalizedSplit) || normalizedSplit < 0 || normalizedSplit > 1) {
      setError("Traffic to B must be a number between 0 and 1");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey, variantAVersion, variantBVersion, trafficSplit: normalizedSplit }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create experiment");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/experiments/${id}`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not stop experiment");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-muted" />
          <h2 className="text-sm font-semibold text-fg">New experiment</h2>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Agent key" htmlFor="exp-agent-key">
            <Select id="exp-agent-key" value={agentKey} onChange={(e) => setAgentKey(e.target.value)} className="w-48">
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Variant A version" htmlFor="exp-variant-a">
            <Select id="exp-variant-a" value={variantAVersion} onChange={(e) => setVariantAVersion(Number(e.target.value))} className="w-28">
              <option value="">—</option>
              {versionsForKey.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Variant B version" htmlFor="exp-variant-b">
            <Select id="exp-variant-b" value={variantBVersion} onChange={(e) => setVariantBVersion(Number(e.target.value))} className="w-28">
              <option value="">—</option>
              {versionsForKey.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Traffic to B (0-1)" htmlFor="exp-traffic-split">
            <Input id="exp-traffic-split" type="number" min="0" max="1" step="0.05" value={trafficSplit} onChange={(e) => setTrafficSplit(e.target.value)} className="w-24" />
          </Field>
          <Button disabled={busy} onClick={create}>
            Start experiment
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      <section>
        <h2 className="text-sm font-semibold text-fg">Experiments</h2>
        {experiments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
            {experiments.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-3.5 text-sm">
                <div>
                  <p className="flex items-center gap-2 font-medium text-fg">
                    {e.agentKey} <Badge variant={e.status === "active" ? "success" : "neutral"}>{e.status}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    A: v{e.variantAVersion} · B: v{e.variantBVersion} · {Math.round(e.trafficSplit * 100)}% to B
                  </p>
                </div>
                {e.status === "active" && (
                  <Button variant="secondary" disabled={busy} onClick={() => stop(e.id)} className="px-3 py-1.5 text-xs">
                    Stop
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
