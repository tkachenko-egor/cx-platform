"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
    setBusy(true);
    try {
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey, variantAVersion, variantBVersion, trafficSplit: Number(trafficSplit) }),
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
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">New experiment</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Agent key</span>
            <select value={agentKey} onChange={(e) => setAgentKey(e.target.value)} className="rounded border border-border bg-bg px-2 py-1">
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Variant A version</span>
            <select value={variantAVersion} onChange={(e) => setVariantAVersion(Number(e.target.value))} className="rounded border border-border bg-bg px-2 py-1">
              <option value="">—</option>
              {versionsForKey.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Variant B version</span>
            <select value={variantBVersion} onChange={(e) => setVariantBVersion(Number(e.target.value))} className="rounded border border-border bg-bg px-2 py-1">
              <option value="">—</option>
              {versionsForKey.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Traffic to B (0-1)</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={trafficSplit}
              onChange={(e) => setTrafficSplit(e.target.value)}
              className="w-20 rounded border border-border bg-bg px-2 py-1"
            />
          </label>
          <button type="button" disabled={busy} onClick={create} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
            Start experiment
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Experiments</h2>
        {experiments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
            {experiments.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-fg">{e.agentKey}</p>
                  <p className="text-xs text-muted">
                    A: v{e.variantAVersion} · B: v{e.variantBVersion} · {Math.round(e.trafficSplit * 100)}% to B · {e.status}
                  </p>
                </div>
                {e.status === "active" && (
                  <button type="button" disabled={busy} onClick={() => stop(e.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50">
                    Stop
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
