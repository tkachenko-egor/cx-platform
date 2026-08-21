"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Provider = "anthropic" | "openai";
const PROVIDERS: Provider[] = ["anthropic", "openai"];

export interface ApiKeyRow {
  id: string;
  provider: string;
  label: string;
  keyLast4: string;
  ownerEmail: string;
  isActive: boolean;
  createdAtFormatted: string;
}

export function ApiKeysManagement({ credentials }: { credentials: ApiKeyRow[] }) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [label, setLabel] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeByProvider = new Set(credentials.filter((c) => c.isActive).map((c) => c.provider));

  const setKey = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, label, plaintextKey }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save key");
      setLabel("");
      setPlaintextKey("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not deactivate key");
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
        <h2 className="text-sm font-medium text-fg">Set a key</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className="rounded border border-border bg-bg px-2 py-1">
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                  {activeByProvider.has(p) ? " (has an active key)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Anthropic (prod)" className="w-48 rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">API key</span>
            <input
              type="password"
              value={plaintextKey}
              onChange={(e) => setPlaintextKey(e.target.value)}
              placeholder="sk-..."
              className="w-64 rounded border border-border bg-bg px-2 py-1"
            />
          </label>
          <button type="button" disabled={busy || !label || !plaintextKey} onClick={setKey} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
            Save key
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">Entered once — it&apos;s never displayed again, only its last 4 characters.</p>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Keys</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
          {credentials.length === 0 && <li className="px-4 py-3 text-sm text-muted">No keys set yet — falling back to the ANTHROPIC_API_KEY/OPENAI_API_KEY env vars, if present.</li>}
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-fg">
                  {c.provider} · {c.label} {!c.isActive && <span className="text-xs text-muted">(inactive)</span>}
                </p>
                <p className="text-xs text-muted">
                  ...{c.keyLast4} · added by {c.ownerEmail} · {c.createdAtFormatted}
                </p>
              </div>
              {c.isActive && (
                <button type="button" disabled={busy} onClick={() => deactivate(c.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50">
                  Deactivate
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
