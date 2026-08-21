"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Macro {
  id: string;
  name: string;
  body: string;
  tags: string[];
}

/** FR-9.6 copilot mode: request a draft, edit it, send it — or hand the conversation back to the bot. */
export function DeskComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [macros, setMacros] = useState<Macro[]>([]);
  const [showMacros, setShowMacros] = useState(false);
  const [macroQuery, setMacroQuery] = useState("");

  useEffect(() => {
    fetch("/api/macros")
      .then((res) => res.json())
      .then((body) => setMacros(body.macros ?? []))
      .catch(() => {});
  }, []);

  const filteredMacros = macros.filter((m) => {
    const q = macroQuery.trim().toLowerCase();
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.body.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q));
  });

  const insertMacro = (macro: Macro) => {
    setDraft(macro.body);
    setShowMacros(false);
    setMacroQuery("");
  };

  const requestDraft = async () => {
    setLoadingDraft(true);
    setError(null);
    try {
      const res = await fetch(`/api/desk/${conversationId}/draft`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not generate a draft");
      setDraft(body.draftText ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDraft(false);
    }
  };

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/desk/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not send");
      setDraft("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const handBack = async () => {
    await fetch(`/api/desk/${conversationId}/handback`, { method: "POST" });
    router.refresh();
  };

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-muted">Reply</h2>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Click “Suggest a reply” for a bot-drafted starting point, or write your own."
        rows={5}
        className="mt-2 w-full resize-none rounded-lg border border-border bg-surface p-3 text-sm text-fg outline-none focus:border-accent"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="relative mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={requestDraft} disabled={loadingDraft} className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg disabled:opacity-50">
          {loadingDraft ? "Drafting…" : "Suggest a reply"}
        </button>
        <button type="button" onClick={() => setShowMacros((v) => !v)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg">
          Macros
        </button>
        <button type="button" onClick={send} disabled={sending || !draft.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40">
          {sending ? "Sending…" : "Send"}
        </button>
        <button type="button" onClick={handBack} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted">
          Hand back to bot
        </button>
        {showMacros && (
          <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-lg border border-border bg-surface p-2 shadow-lg">
            <input
              autoFocus
              value={macroQuery}
              onChange={(e) => setMacroQuery(e.target.value)}
              placeholder="Search macros…"
              className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent"
            />
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {filteredMacros.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted">No macros found.</p>
              ) : (
                filteredMacros.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => insertMacro(m)}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-accent/10"
                  >
                    <p className="font-medium">{m.name}</p>
                    <p className="truncate text-muted">{m.body}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
