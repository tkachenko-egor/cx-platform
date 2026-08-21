"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
}

export function TenantManagement({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, { name: string; slug: string }>>({});

  const createTenant = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/platform-admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create tenant");
      setName("");
      setSlug("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveTenant = async (id: string) => {
    const draft = editing[id];
    if (!draft) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/platform-admin/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update tenant");
      setEditing((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
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
        <h2 className="text-sm font-medium text-fg">New tenant</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-48 rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Slug</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-co" className="w-40 rounded border border-border bg-bg px-2 py-1" />
          </label>
          <button type="button" disabled={busy || !name || !slug} onClick={createTenant} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
            Create tenant
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Tenants</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
          {tenants.map((t) => {
            const draft = editing[t.id];
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                {draft ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      value={draft.name}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: { ...draft, name: e.target.value } }))}
                      className="w-40 rounded border border-border bg-bg px-2 py-1 text-xs"
                    />
                    <input
                      value={draft.slug}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: { ...draft, slug: e.target.value } }))}
                      className="w-32 rounded border border-border bg-bg px-2 py-1 text-xs"
                    />
                    <button type="button" disabled={busy} onClick={() => saveTenant(t.id)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
                      Save
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium text-fg">{t.name}</p>
                    <p className="text-xs text-muted">{t.slug}.localhost:3000</p>
                  </div>
                )}
                {!draft && (
                  <button
                    type="button"
                    onClick={() => setEditing((prev) => ({ ...prev, [t.id]: { name: t.name, slug: t.slug } }))}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg"
                  >
                    Edit
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
