import type { ChannelAdapter, CanonicalInboundMessage, CanonicalOutboundMessage, DeliveryReceipt, ChannelCapabilities } from "../types";
import type { EmailProviderAdapter } from "./provider";
import { stripQuotedContent } from "./strip-quoted";
import { isAutoResponse } from "./autoresponder";

export interface InboundEmailPayload {
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  from: string;
  subject: string;
  textBody: string;
  headers: Record<string, string>;
}

const EMAIL_CAPABILITIES: ChannelCapabilities = { streaming: false, attachments: false, richCards: false, typingIndicators: false, readReceipts: false };

/** FR-3.11-3.16: webhook-based inbound (not IMAP polling), threading, quoted-reply stripping, autoresponder guard. */
export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel = "email" as const;
  readonly capabilities = EMAIL_CAPABILITIES;

  constructor(private readonly provider: EmailProviderAdapter) {}

  receive(raw: InboundEmailPayload): CanonicalInboundMessage | null {
    if (isAutoResponse(raw.headers, raw.subject)) return null;

    return {
      channel: "email",
      text: stripQuotedContent(raw.textBody),
      externalMessageId: raw.messageId,
      inReplyToExternalId: raw.inReplyTo,
      metadata: { from: raw.from, subject: raw.subject, references: raw.references ?? [] },
    };
  }

  send(message: CanonicalOutboundMessage): Promise<DeliveryReceipt> {
    return this.provider.send(message);
  }
}
