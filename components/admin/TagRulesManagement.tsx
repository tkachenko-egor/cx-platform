"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { Badge } from "../ui/Badge";

export interface TagRuleRow {
  id: string;
  tag: string;
  keywords: string[];
}

/** Phase 9 M4: keyword -> tag mappings — deterministic, not an LLM classifier (see src/channel/turn.ts's scanAutoTags). */
export function TagRulesManagement({ rules }: { rules: TagRuleRow[] }) {
  const router = useRouter();
  const [tag, setTag] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tag-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, keywords }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create rule");
      setTag("");
      setKeywords([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/admin/tag-rules/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-4">
        <h2 className="text-sm font-medium text-fg">New rule</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <Field label="Tag" htmlFor="new-tag-name">
            <Input id="new-tag-name" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. billing" className="w-40" />
          </Field>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-fg">Keywords</span>
            <div className="flex flex-wrap gap-2">
              {keywords.map((k, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg">
                  {k}
                  <button type="button" onClick={() => setKeywords((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !newKeyword.trim()) return;
                  e.preventDefault();
                  setKeywords((prev) => [...prev, newKeyword.trim()]);
                  setNewKeyword("");
                }}
                placeholder="e.g. invoice"
                className="w-48"
              />
            </div>
          </div>
          <Button disabled={busy || !tag.trim() || keywords.length === 0} onClick={create}>
            Add rule
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      <section>
        <h2 className="text-sm font-medium text-muted">Rules</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
          {rules.length === 0 && <li className="px-4 py-3 text-sm text-muted">No auto-tag rules yet.</li>}
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge>{rule.tag}</Badge>
                <span className="text-xs text-muted">{rule.keywords.join(", ")}</span>
              </div>
              <button type="button" disabled={busy} onClick={() => remove(rule.id)} className="text-xs text-danger hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
