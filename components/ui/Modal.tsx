"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

const SIZE_CLASSES = {
  md: "max-w-lg p-6",
  lg: "h-[80vh] max-w-2xl p-0",
};

/** Phase 6 M6: first Modal in this codebase — centered dialog, backdrop/Esc to close, matching Card's rounded-2xl/border/shadow language. `size="lg"` (Milestone 6, the test-agent modal) drops the default padding since a chat pane wants full-bleed content, not a padded form. */
export function Modal({ title, onClose, children, size = "md" }: { title: string; onClose: () => void; children: ReactNode; size?: keyof typeof SIZE_CLASSES }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ${SIZE_CLASSES[size]}`}
      >
        {size === "lg" ? (
          <div className="min-h-0 flex-1">{children}</div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-bg hover:text-fg">
                <X size={16} />
              </button>
            </div>
            <div className="mt-4">{children}</div>
          </>
        )}
      </div>
    </div>
  );
}
