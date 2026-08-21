"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Position = "bottom-right" | "bottom-left";

export interface WidgetConfigInitial {
  title: string;
  greetingText: string;
  primaryColor: string;
  logoUrl: string | null;
  position: Position;
  publicKey: string;
}

export function WidgetConfigEditor({ agentKey, initial }: { agentKey: string; initial: WidgetConfigInitial | null }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "Support");
  const [greetingText, setGreetingText] = useState(initial?.greetingText ?? "");
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? "#3454d1");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [position, setPosition] = useState<Position>(initial?.position ?? "bottom-right");
  const [publicKey, setPublicKey] = useState(initial?.publicKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = publicKey ? `<script src="${origin}/widget.js" data-widget-key="${publicKey}" data-position="${position}"></script>` : null;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/widget-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey, title, greetingText, primaryColor, logoUrl: logoUrl || null, position }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save widget config");
      const { config } = await res.json();
      setPublicKey(config.publicKey);
      setPreviewNonce((n) => n + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!confirm("Rotate the embed key? The current snippet (wherever it's pasted) will stop working immediately.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/widget-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not rotate key");
      const { config } = await res.json();
      setPublicKey(config.publicKey);
      setPreviewNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">Appearance</h2>
        <div className="mt-3 space-y-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Greeting (shown before the first message)</span>
            <textarea value={greetingText} onChange={(e) => setGreetingText(e.target.value)} rows={3} placeholder="Hello! How can I help?" className="rounded border border-border bg-bg px-2 py-1" />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Primary color</span>
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-16 rounded border border-border bg-bg" />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-muted">Logo URL (optional)</span>
              <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" className="rounded border border-border bg-bg px-2 py-1" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Position</span>
            <select value={position} onChange={(e) => setPosition(e.target.value as Position)} className="rounded border border-border bg-bg px-2 py-1">
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
            {publicKey ? "Save changes" : "Create widget"}
          </button>
          {publicKey && (
            <button type="button" disabled={busy} onClick={rotate} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50">
              Rotate embed key
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        {snippet && (
          <div className="mt-4">
            <span className="text-xs text-muted">Paste this on any page — it works cross-origin</span>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-bg px-3 py-2 text-[11px] text-fg">{snippet}</pre>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">Live preview</h2>
        {publicKey ? (
          <div className="relative mt-3 h-[520px] overflow-hidden rounded-lg border border-border bg-bg">
            <iframe key={previewNonce} src={`/embed/${publicKey}`} title="Widget preview" className="h-full w-full border-none" />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Save once to get an embed key, then the live preview and snippet appear here.</p>
        )}
      </section>
    </div>
  );
}
