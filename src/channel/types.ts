import type { ConversationChannel } from "../core/types";

/**
 * FR-3's common channel contract: every channel adapter speaks these two
 * shapes and nothing else. The orchestrator (src/channel/turn.ts) never
 * sees a channel-specific payload — that's the whole point.
 */
export interface CanonicalInboundMessage {
  channel: ConversationChannel;
  /** Known when the channel can resolve an existing thread itself (e.g. email threading); undefined starts a new conversation. */
  conversationId?: string;
  text: string;
  /** e.g. an email Message-ID — recorded on the persisted message for threading. */
  externalMessageId?: string;
  inReplyToExternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalOutboundMessage {
  conversationId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryReceipt {
  ok: boolean;
  detail?: string;
}

export interface ChannelCapabilities {
  streaming: boolean;
  attachments: boolean;
  richCards: boolean;
  typingIndicators: boolean;
  readReceipts: boolean;
}

export interface ChannelAdapter {
  readonly channel: ConversationChannel;
  readonly capabilities: ChannelCapabilities;
  /** Returns null when the channel deliberately drops the inbound event (e.g. FR-3.16's autoresponder loop guard). */
  receive(raw: unknown): CanonicalInboundMessage | null;
  send(message: CanonicalOutboundMessage): Promise<DeliveryReceipt>;
}
