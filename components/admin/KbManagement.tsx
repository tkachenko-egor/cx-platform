"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface KbArticleRow {
  docId: string;
  title: string;
  audience: string;
  effective: string | null;
  body: string;
  /** body === "" is the only signal we have — an admin-saved article always has a non-empty body (form requires it). */
  isFileSourced: boolean;
}

const AUDIENCE_SUGGESTIONS = ["customer", "advisor", "internal"];

export function KbManagement({ articles }: { articles: KbArticleRow[] }) {
  const router = useRouter();
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docId, setDocId] = useState("");
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("customer");
  const [effective, setEffective] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setEditingDocId(null);
    setDocId("");
    setTitle("");
    setAudience("customer");
    setEffective("");
    setBody("");
  };

  const edit = (row: KbArticleRow) => {
    setEditingDocId(row.docId);
    setDocId(row.docId);
    setTitle(row.title);
    setAudience(row.audience);
    setEffective(row.effective ?? "");
    setBody(row.body);
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const payload = { docId: editingDocId ? undefined : docId || undefined, title, audience, effective: effective || null, body };
      const res = await fetch(editingDocId ? `/api/admin/kb/${editingDocId}` : "/api/admin/kb", {
        method: editingDocId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save article");
      resetForm();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (targetDocId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/kb/${targetDocId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete article");
      if (editingDocId === targetDocId) resetForm();
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg">{editingDocId ? `Edit "${editingDocId}"` : "New article"}</h2>
          {editingDocId && (
            <button type="button" onClick={resetForm} className="text-xs text-muted hover:text-fg">
              Cancel
            </button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          {!editingDocId && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Doc id (optional — derived from title if left blank)</span>
              <input value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="e.g. warranty-policy" className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs" />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Audience</span>
            <input value={audience} onChange={(e) => setAudience(e.target.value)} list="kb-audiences" className="rounded border border-border bg-bg px-2 py-1" />
            <datalist id="kb-audiences">
              {AUDIENCE_SUGGESTIONS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Effective date (optional)</span>
            <input value={effective} onChange={(e) => setEffective(e.target.value)} placeholder="e.g. 2026-01-01" className="rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs text-muted">Body (markdown — cited as [{docId || editingDocId || "doc_id"}])</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs" />
          </label>
        </div>
        <button type="button" disabled={busy || !title || !body} onClick={save} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
          {editingDocId ? "Save changes" : "Create article"}
        </button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Articles</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
          {articles.length === 0 && <li className="px-4 py-3 text-sm text-muted">No articles yet.</li>}
          {articles.map((row) => (
            <li key={row.docId} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-fg">
                  {row.title} <span className="text-xs text-muted font-mono">[{row.docId}]</span> <span className="text-xs text-muted">· {row.audience}</span>
                  {row.isFileSourced && <span className="text-xs text-muted"> · from file</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!row.isFileSourced && (
                  <>
                    <button type="button" onClick={() => edit(row)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg">
                      Edit
                    </button>
                    <button type="button" disabled={busy} onClick={() => remove(row.docId)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50">
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
