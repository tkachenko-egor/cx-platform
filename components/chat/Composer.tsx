"use client";

import { useState, type KeyboardEvent } from "react";

export function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-2 border-t border-border bg-surface p-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 2000))}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder="Type a message…"
        aria-label="Message"
        className="max-h-24 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/15"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg shadow-sm transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
      >
        Send
      </button>
    </div>
  );
}
