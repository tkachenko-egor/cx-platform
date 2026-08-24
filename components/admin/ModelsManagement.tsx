"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROVIDERS = ["anthropic"] as const;
const KNOWN_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
};

export interface FallbackTargetRow {
  provider: string;
  model: string;
}

export interface ModelAliasRow {
  alias: string;
  provider: string;
  model: string;
  fallbackChain?: FallbackTargetRow[];
}

export function ModelsManagement({ aliases }: { aliases: ModelAliasRow[] }) {
  const router = useRouter();
  const [alias, setAlias] = useState("");
  const [provider, setProvider] = useState<string>(PROVIDERS[0]);
  const [model, setModel] = useState("");
  const [fallbackChain, setFallbackChain] = useState<FallbackTargetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, provider, model, fallbackChain }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save alias");
      setAlias("");
      setModel("");
      setFallbackChain([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const edit = (row: ModelAliasRow) => {
    setAlias(row.alias);
    setProvider(row.provider);
    setModel(row.model);
    setFallbackChain(row.fallbackChain ?? []);
  };

  const addFallback = () => setFallbackChain((prev) => [...prev, { provider: PROVIDERS[0], model: "" }]);
  const updateFallback = (index: number, patch: Partial<FallbackTargetRow>) =>
    setFallbackChain((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const removeFallback = (index: number) => setFallbackChain((prev) => prev.filter((_, i) => i !== index));

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">{aliases.some((a) => a.alias === alias) ? "Edit alias" : "New alias"}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Alias name</span>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. support-default" className="w-48 rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded border border-border bg-bg px-2 py-1">
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="known-models"
              placeholder="e.g. claude-sonnet-5"
              className="w-64 rounded border border-border bg-bg px-2 py-1"
            />
            <datalist id="known-models">
              {(KNOWN_MODELS[provider] ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <button type="button" disabled={busy || !alias || !model} onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
            Save alias
          </button>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg">Fallback chain</span>
            <button type="button" onClick={addFallback} className="text-xs text-accent hover:underline">
              + Add fallback
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">Tried in order if a call to the primary model errors or is rate-limited (src/gateway/gateway.ts).</p>
          {fallbackChain.length === 0 && <p className="mt-1 text-xs text-muted">No fallback configured — a provider error or rate limit fails the turn.</p>}
          <div className="mt-2 space-y-2">
            {fallbackChain.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted">{i + 1}.</span>
                <select value={f.provider} onChange={(e) => updateFallback(i, { provider: e.target.value })} className="rounded border border-border bg-bg px-2 py-1 text-sm">
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <input
                  value={f.model}
                  onChange={(e) => updateFallback(i, { model: e.target.value })}
                  list="known-models"
                  placeholder="e.g. claude-haiku-4-5-20251001"
                  className="w-64 rounded border border-border bg-bg px-2 py-1 text-sm"
                />
                <button type="button" onClick={() => removeFallback(i)} className="text-xs text-danger hover:underline">
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-3 text-xs text-muted">The API key used to call this model comes from Admin &gt; API Keys — one key per provider, shared by every agent.</p>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Aliases</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
          {aliases.length === 0 && <li className="px-4 py-3 text-sm text-muted">No aliases yet.</li>}
          {aliases.map((row) => (
            <li key={row.alias} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-fg">{row.alias}</p>
                <p className="text-xs text-muted font-mono">
                  {row.provider}:{row.model}
                </p>
              </div>
              <button type="button" onClick={() => edit(row)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg">
                Edit
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
