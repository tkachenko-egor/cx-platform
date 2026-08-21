import type { ChannelAdapter, CanonicalInboundMessage, DeliveryReceipt, ChannelCapabilities } from "./types";

export interface WidgetInboundPayload {
  conversationId?: string;
  message: string;
}

const WIDGET_CAPABILITIES: ChannelCapabilities = { streaming: true, attachments: false, richCards: true, typingIndicators: true, readReceipts: false };

/**
 * The widget delivers its reply as a live token-by-token SSE stream from
 * the route handler itself (FR-3.2), not as a single post-hoc message — so
 * `send()` here is a documented no-op rather than a real delivery path;
 * `receive()` is what proves the channel contract, since it's the same
 * shape app/api/channels/email/inbound/route.ts's EmailChannelAdapter uses.
 */
export class WidgetChannelAdapter implements ChannelAdapter {
  readonly channel = "widget" as const;
  readonly capabilities = WIDGET_CAPABILITIES;

  receive(raw: WidgetInboundPayload): CanonicalInboundMessage {
    return { channel: "widget", conversationId: raw.conversationId, text: raw.message };
  }

  async send(): Promise<DeliveryReceipt> {
    return { ok: true, detail: "delivered via SSE stream, not send()" };
  }
}
