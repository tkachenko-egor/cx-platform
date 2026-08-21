"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROVIDERS = ["anthropic"] as const;
const KNOWN_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
};

export interface ModelAliasRow {
  alias: string;
  provider: string;
  model: string;
}

export function ModelsManagement({ aliases }: { aliases: ModelAliasRow[] }) {
  const router = useRouter();
  const [alias, setAlias] = useState("");
  const [provider, setProvider] = useState<string>(PROVIDERS[0]);
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, provider, model }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save alias");
      setAlias("");
      setModel("");
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
  };

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
        <p className="mt-2 text-xs text-muted">The API key used to call this model comes from Admin &gt; API Keys — one key per provider, shared by every agent.</p>
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
