import type { CSSProperties, ReactNode } from "react";

/**
 * Shared bubble chrome for both the real widget (ChatPanel) and the admin mock preview
 * (WidgetMockPreview) — one definition so the two can't drift apart. Colors come from
 * `--color-user-bubble`/`--color-bot-bubble` CSS custom properties set by an ancestor
 * (the embed page or the mock preview's root), not props, so this component itself never
 * needs to know where the tenant's chosen colors came from.
 */
export function MessageBubble({ role, children }: { role: "user" | "bot"; children: ReactNode }) {
  if (role === "user") {
    return (
      <div
        className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm shadow-sm"
        style={{ background: "var(--color-user-bubble)", color: "var(--color-user-bubble-fg)" }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className="max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm"
      style={{ backgroundColor: "var(--color-bot-bubble)", "--color-fg": "var(--color-bot-bubble-fg)" } as CSSProperties}
    >
      {children}
    </div>
  );
}
