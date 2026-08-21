import type { CSSProperties } from "react";
import { MessageBubble } from "../chat/MessageBubble";
import { readableTextColor } from "../../src/lib/color-contrast";
import { WIDGET_FONTS, type WidgetFontKey } from "../../src/platform/widget-fonts";

/**
 * Instant, unsaved-state preview of widget appearance — no iframe, no round-trip to
 * /embed/{publicKey}. Renders the same MessageBubble the real widget uses, scoped to the
 * in-progress form values via inline CSS custom properties (same shadowing trick the embed
 * page uses), so picking a color or font shows up here immediately.
 */
export function WidgetMockPreview({
  title,
  greetingText,
  logoUrl,
  primaryColor,
  userBubbleColor,
  botBubbleColor,
  fontFamily,
}: {
  title: string;
  greetingText: string;
  logoUrl: string;
  primaryColor: string;
  userBubbleColor: string;
  botBubbleColor: string;
  fontFamily: WidgetFontKey;
}) {
  const font = WIDGET_FONTS[fontFamily] ?? WIDGET_FONTS.inter;

  return (
    <div
      className="flex h-[420px] flex-col overflow-hidden rounded-lg border border-border bg-surface"
      style={
        {
          "--color-accent": primaryColor,
          "--color-accent-fg": readableTextColor(primaryColor),
          "--color-user-bubble": userBubbleColor,
          "--color-user-bubble-fg": readableTextColor(userBubbleColor),
          "--color-bot-bubble": botBubbleColor,
          "--color-bot-bubble-fg": readableTextColor(botBubbleColor),
          fontFamily: font.css,
        } as CSSProperties
      }
    >
      {"googleFontsUrl" in font && <link rel="stylesheet" href={font.googleFontsUrl} />}

      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {logoUrl && <img src={logoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />}
        <div>
          <p className="text-sm font-medium text-fg">{title || "Support"}</p>
          <p className="text-[11px] text-muted">AI assistant · a person can join anytime</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <MessageBubble role="bot">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{greetingText || "Hi! How can I help you today?"}</p>
        </MessageBubble>
        <div className="flex justify-end">
          <MessageBubble role="user">I&apos;d like to check my order status</MessageBubble>
        </div>
        <MessageBubble role="bot">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">Sure! Could you share your order number?</p>
        </MessageBubble>
      </div>

      <div className="flex items-end gap-2 border-t border-border bg-surface p-3">
        <div className="max-h-24 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted">Type a message…</div>
        <button type="button" disabled className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg shadow-sm disabled:opacity-90">
          Send
        </button>
      </div>
    </div>
  );
}
