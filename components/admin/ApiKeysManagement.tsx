"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { Badge } from "../ui/Badge";

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
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-muted" />
          <h2 className="text-sm font-semibold text-fg">Set a key</h2>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Provider" htmlFor="key-provider">
            <Select id="key-provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className="w-48">
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                  {activeByProvider.has(p) ? " (has an active key)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Label" htmlFor="key-label">
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Anthropic (prod)" className="w-56" />
          </Field>
          <Field label="API key" htmlFor="key-secret">
            <Input id="key-secret" type="password" value={plaintextKey} onChange={(e) => setPlaintextKey(e.target.value)} placeholder="sk-..." className="w-64" />
          </Field>
          <Button disabled={busy || !label || !plaintextKey} onClick={setKey}>
            Save key
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">Entered once — it&apos;s never displayed again, only its last 4 characters.</p>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      <section>
        <h2 className="text-sm font-semibold text-fg">Keys</h2>
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
          {credentials.length === 0 && <li className="px-5 py-3.5 text-sm text-muted">No keys set yet — falling back to the ANTHROPIC_API_KEY/OPENAI_API_KEY env vars, if present.</li>}
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-5 py-3.5 text-sm">
              <div>
                <p className="flex items-center gap-2 font-medium text-fg">
                  {c.provider} · {c.label}
                  {!c.isActive && <Badge>Inactive</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  ...{c.keyLast4} · added by {c.ownerEmail} · {c.createdAtFormatted}
                </p>
              </div>
              {c.isActive && (
                <Button variant="secondary" disabled={busy} onClick={() => deactivate(c.id)} className="px-3 py-1.5 text-xs">
                  Deactivate
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
