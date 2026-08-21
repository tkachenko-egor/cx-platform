"use client";

import { useEffect, useRef } from "react";
import { useChat } from "./ChatProvider";
import { ChatPanel } from "./ChatPanel";

export function ChatWidget() {
  const { open, setOpen, hasUnread } = useChat();
  const panelRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
    else bubbleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label="AI assistant"
          className="fixed inset-0 z-50 flex flex-col border border-border bg-surface shadow-2xl outline-none min-[640px]:inset-auto min-[640px]:bottom-24 min-[640px]:right-6 min-[640px]:h-[640px] min-[640px]:w-[400px] min-[640px]:rounded-2xl"
        >
          {/* NFR-6.2: AI disclosure, visible at first interaction, not buried. */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-fg">Support</p>
              <p className="text-[11px] text-muted">AI assistant · a person can join anytime</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="rounded-full p-1 text-muted hover:bg-fg/5 hover:text-fg">
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ChatPanel />
          </div>
        </div>
      )}

      <button
        ref={bubbleRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close chat" : "Open chat"}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg hover:opacity-90"
      >
        <span aria-hidden>💬</span>
        {hasUnread && !open && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg bg-danger" aria-hidden />}
      </button>
    </>
  );
}
