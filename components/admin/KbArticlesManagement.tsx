"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Pencil, Trash2, FileText } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { Pagination } from "../ui/Pagination";

export interface KbArticleRow {
  docId: string;
  title: string;
  audience: string;
  effective: string | null;
  body: string;
  /** body === "" is the only signal we have — an admin-saved/imported article always has a non-empty body (form/import both require it). */
  isFileSourced: boolean;
}

const AUDIENCE_SUGGESTIONS = ["customer", "advisor", "internal"];
const PAGE_SIZE = 8;

export function KbArticlesManagement({ collectionId, articles }: { collectionId: string; articles: KbArticleRow[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [docId, setDocId] = useState("");
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("customer");
  const [effective, setEffective] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const visible = articles.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const resetForm = () => {
    setEditingDocId(null);
    setFormOpen(false);
    setDocId("");
    setTitle("");
    setAudience("customer");
    setEffective("");
    setBody("");
  };

  const edit = (row: KbArticleRow) => {
    setEditingDocId(row.docId);
    setFormOpen(true);
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
      const payload = { docId: editingDocId ? undefined : docId || undefined, title, audience, effective: effective || null, body, collectionId };
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

  const onFilePicked = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/admin/kb-collections/${collectionId}/import`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not import file");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={formOpen ? "ghost" : "secondary"} onClick={() => (formOpen ? resetForm() : setFormOpen(true))}>
          {formOpen ? "Cancel" : "+ New article"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFilePicked(file);
          }}
        />
        <Button variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          <Upload size={15} /> Import .md / .pdf
        </Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      {formOpen && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">{editingDocId ? `Edit "${editingDocId}"` : "New article"}</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {!editingDocId && (
              <Field label="Doc id (optional — derived from title)" htmlFor="kb-doc-id">
                <Input id="kb-doc-id" value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="e.g. warranty-policy" className="font-mono text-xs" />
              </Field>
            )}
            <Field label="Title" htmlFor="kb-title">
              <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Audience" htmlFor="kb-audience">
              <Input id="kb-audience" value={audience} onChange={(e) => setAudience(e.target.value)} list="kb-audiences" />
              <datalist id="kb-audiences">
                {AUDIENCE_SUGGESTIONS.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <Field label="Effective date (optional)" htmlFor="kb-effective">
              <Input id="kb-effective" value={effective} onChange={(e) => setEffective(e.target.value)} placeholder="e.g. 2026-01-01" />
            </Field>
            <div className="sm:col-span-2">
              <Field label={`Body (markdown — cited as [${docId || editingDocId || "doc_id"}])`} htmlFor="kb-body">
                <textarea
                  id="kb-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                />
              </Field>
            </div>
          </div>
          <div className="mt-4">
            <Button disabled={busy || !title || !body} onClick={save}>
              {editingDocId ? "Save changes" : "Create article"}
            </Button>
          </div>
        </Card>
      )}

      {articles.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No articles in this Knowledge Base yet.</Card>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
            {visible.map((row) => (
              <li key={row.docId} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText size={16} className="shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">
                      {row.title} <span className="text-xs text-muted">· {row.audience}</span>
                      {row.isFileSourced && <span className="text-xs text-muted"> · from file</span>}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">[{row.docId}]</p>
                  </div>
                </div>
                {!row.isFileSourced && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => edit(row)} aria-label="Edit" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-fg">
                      <Pencil size={14} />
                    </button>
                    <button type="button" disabled={busy} onClick={() => remove(row.docId)} aria-label="Delete" className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} />
        </>
      )}
    </div>
  );
}
