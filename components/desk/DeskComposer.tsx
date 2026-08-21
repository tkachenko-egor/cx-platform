"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** FR-9.6 copilot mode: request a draft, edit it, send it — or hand the conversation back to the bot. */
export function DeskComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={requestDraft} disabled={loadingDraft} className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg disabled:opacity-50">
          {loadingDraft ? "Drafting…" : "Suggest a reply"}
        </button>
        <button type="button" onClick={send} disabled={sending || !draft.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40">
          {sending ? "Sending…" : "Send"}
        </button>
        <button type="button" onClick={handBack} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted">
          Hand back to bot
        </button>
      </div>
    </section>
  );
}
