"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, BookOpen, FileText, Trash2 } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { Pagination } from "../ui/Pagination";

export interface KbCollectionRow {
  id: string;
  name: string;
  description: string;
  articleCount: number;
}

const PAGE_SIZE = 9;

export function KbCollectionsManagement({ collections }: { collections: KbCollectionRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(collections.length / PAGE_SIZE));
  const visible = collections.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const remove = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/kb-collections/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete Knowledge Base");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/kb-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create Knowledge Base");
      setName("");
      setDescription("");
      setCreating(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      {creating ? (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">New Knowledge Base</h2>
            <button type="button" onClick={() => setCreating(false)} className="text-xs text-muted hover:text-fg">
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="kb-name">
              <Input id="kb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Returns & Policies" />
            </Field>
            <Field label="Description (optional)" htmlFor="kb-description">
              <Input id="kb-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What lives in this KB" />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button disabled={busy || !name.trim()} onClick={create}>
              {busy ? "Creating…" : "Create"}
            </Button>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New Knowledge Base
        </Button>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {collections.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No Knowledge Bases yet — create one to start adding articles.</Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <Card key={c.id} className="relative flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-md">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(c.id)}
                  aria-label="Delete"
                  className="absolute right-3 top-3 rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
                <Link href={`/admin/kb/${c.id}`} className="flex h-full flex-col gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <BookOpen size={17} />
                  </div>
                  <div className="min-w-0 flex-1 pr-6">
                    <p className="truncate font-medium text-fg">{c.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{c.description || "No description"}</p>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <FileText size={12} />
                    {c.articleCount} {c.articleCount === 1 ? "article" : "articles"}
                  </p>
                </Link>
              </Card>
            ))}
          </div>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} />
        </>
      )}
    </div>
  );
}
