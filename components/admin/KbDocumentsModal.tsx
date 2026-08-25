"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Pencil, Trash2, FileText, Search } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";

interface ArticleRow {
  docId: string;
  title: string;
  audience: string;
  effective: string | null;
  body: string;
  isFileSourced: boolean;
}

const modalFieldClass = "w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";
// KB-05: same suggestions as KbArticlesManagement.tsx's audience field — this modal is the other
// place an article's audience gets set (from the agent builder), and had no hint of valid values at all.
const AUDIENCE_SUGGESTIONS = ["customer", "advisor", "internal"];

/**
 * Phase 6: search + add + import, reachable straight from the agent builder's Knowledge card
 * instead of requiring a trip to Admin > Knowledge base. Self-fetching (not server-prop-fed like
 * KbArticlesManagement) since it's opened from a client component with no server round trip.
 */
export function KbDocumentsModal({ collectionId, collectionName, onClose }: { collectionId: string; collectionName: string; onClose: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [articles, setArticles] = useState<ArticleRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docId, setDocId] = useState("");
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("customer");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/admin/kb?collectionId=${collectionId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { articles: { docId: string; title: string; audience: string; effective: string | null; body: string }[] };
    setArticles(data.articles.map((a) => ({ ...a, isFileSourced: a.body === "" })));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-open for a modal with no server-prop path to feed it
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  const resetForm = () => {
    setFormOpen(false);
    setEditingDocId(null);
    setDocId("");
    setTitle("");
    setAudience("customer");
    setBody("");
  };

  const edit = (row: ArticleRow) => {
    setFormOpen(true);
    setEditingDocId(row.docId);
    setDocId(row.docId);
    setTitle(row.title);
    setAudience(row.audience);
    setBody(row.body);
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const payload = { docId: editingDocId ? undefined : docId || undefined, title, audience, effective: null, body, collectionId };
      const res = await fetch(editingDocId ? `/api/admin/kb/${editingDocId}` : "/api/admin/kb", {
        method: editingDocId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save article");
      resetForm();
      await load();
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onFilePicked = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/admin/kb-collections/${collectionId}/import`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not import file");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filtered = (articles ?? []).filter((a) => !search.trim() || a.title.toLowerCase().includes(search.trim().toLowerCase()) || a.docId.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal title={`${collectionName} — documents`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={formOpen ? "ghost" : "secondary"} onClick={() => (formOpen ? resetForm() : setFormOpen(true))}>
            {formOpen ? "Cancel" : "+ New document"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFilePicked(file);
            }}
          />
          <Button variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Import
          </Button>
          <div className="relative ml-auto w-40">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full rounded-lg border border-border bg-bg py-1.5 pl-7 pr-2 text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" />
          </div>
        </div>

        {formOpen && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            {!editingDocId && (
              <Field label="Doc id (optional — derived from title)" htmlFor="kbm-doc-id">
                <Input id="kbm-doc-id" value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="e.g. warranty-policy" className="font-mono text-xs" />
              </Field>
            )}
            <Field label="Title" htmlFor="kbm-title">
              <Input id="kbm-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Audience" htmlFor="kbm-audience">
              <Input id="kbm-audience" value={audience} onChange={(e) => setAudience(e.target.value)} list="kbm-audiences" />
              <datalist id="kbm-audiences">
                {AUDIENCE_SUGGESTIONS.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <Field label="Body (markdown)" htmlFor="kbm-body">
              <textarea id="kbm-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={modalFieldClass} />
            </Field>
            <Button disabled={busy || !title || !body} onClick={save}>
              {editingDocId ? "Save changes" : "Create document"}
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        {articles === null ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">{articles.length === 0 ? "No documents yet." : `No documents match "${search}".`}</p>
        ) : (
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {filtered.map((row) => (
              <li key={row.docId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText size={14} className="shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="truncate text-fg">
                      {row.title} <span className="text-xs text-muted">· {row.audience}</span>
                      {row.isFileSourced && <span className="text-xs text-muted"> · from file</span>}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!row.isFileSourced && (
                    <button type="button" onClick={() => edit(row)} aria-label="Edit" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-fg">
                      <Pencil size={13} />
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => remove(row.docId)} aria-label="Delete" className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50">
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
