import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getWidgetContext } from "../../../src/platform/widget-context";
import { ChatProvider } from "../../../components/chat/ChatProvider";
import { ChatWidget } from "../../../components/chat/ChatWidget";
import { EmbedResizeBridge } from "../../../components/chat/EmbedResizeBridge";

export const dynamic = "force-dynamic";

/** Relative luminance (WCAG) — picks black or white text over an admin-chosen accent color so contrast stays readable regardless of what they pick. */
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const [lr, lg, lb] = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  return luminance > 0.5 ? "#17181c" : "#ffffff";
}

/** Phase 4 M4: what a customer's <iframe src="/embed/{publicKey}"> actually loads — the loader script (public/widget.js) creates that iframe, this page renders the real widget inside it, themed from widget_configs. No admin/desk chrome; this route has none to begin with. */
export default async function EmbedPage(props: PageProps<"/embed/[publicKey]">) {
  const { publicKey } = await props.params;
  const widget = getWidgetContext(publicKey);
  if (!widget) notFound();

  const { title, greetingText, primaryColor, logoUrl, agentKey } = widget.widgetConfig;

  return (
    <div
      style={{ "--color-accent": primaryColor, "--color-accent-fg": readableTextColor(primaryColor) } as CSSProperties}
      data-embed-agent={agentKey}
    >
      <ChatProvider chatEndpoint={`/api/embed-chat/${publicKey}`} messagesEndpointBase={`/api/embed-chat/${publicKey}/messages`} greeting={greetingText || undefined}>
        <EmbedResizeBridge />
        <ChatWidget title={title} position={widget.widgetConfig.position} logoUrl={logoUrl} />
      </ChatProvider>
    </div>
  );
}
