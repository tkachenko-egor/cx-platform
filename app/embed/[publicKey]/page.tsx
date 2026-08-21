import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getWidgetContext } from "../../../src/platform/widget-context";
import { AgentDefRepository } from "../../../src/db/repositories/agent-def-repository";
import { ChatProvider } from "../../../components/chat/ChatProvider";
import { ChatWidget } from "../../../components/chat/ChatWidget";
import { EmbedResizeBridge } from "../../../components/chat/EmbedResizeBridge";
import { readableTextColor } from "../../../src/lib/color-contrast";
import { WIDGET_FONTS } from "../../../src/platform/widget-fonts";

export const dynamic = "force-dynamic";

/** Phase 4 M4: what a customer's <iframe src="/embed/{publicKey}"> actually loads — the loader script (public/widget.js) creates that iframe, this page renders the real widget inside it, themed from widget_configs. No admin/desk chrome; this route has none to begin with. */
export default async function EmbedPage(props: PageProps<"/embed/[publicKey]">) {
  const { publicKey } = await props.params;
  const widget = getWidgetContext(publicKey);
  if (!widget) notFound();

  const { title, greetingText, primaryColor, logoUrl, agentKey, fontFamily, userBubbleColor, botBubbleColor } = widget.widgetConfig;
  const quickReplies = new AgentDefRepository(widget.db, widget.tenant).getLatestPublished(agentKey)?.quickReplies;
  const font = WIDGET_FONTS[fontFamily] ?? WIDGET_FONTS.inter;

  return (
    <div
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
      data-embed-agent={agentKey}
    >
      {"googleFontsUrl" in font && <link rel="stylesheet" href={font.googleFontsUrl} />}
      <ChatProvider
        chatEndpoint={`/api/embed-chat/${publicKey}`}
        messagesEndpointBase={`/api/embed-chat/${publicKey}/messages`}
        greeting={greetingText || undefined}
        quickReplies={quickReplies?.length ? quickReplies : undefined}
      >
        <EmbedResizeBridge />
        <ChatWidget title={title} position={widget.widgetConfig.position} logoUrl={logoUrl} />
      </ChatProvider>
    </div>
  );
}
