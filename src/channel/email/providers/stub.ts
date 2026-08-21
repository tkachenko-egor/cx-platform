import { randomUUID } from "node:crypto";
import type { EmailProviderAdapter } from "../provider";
import type { CanonicalOutboundMessage, DeliveryReceipt } from "../../types";

/** Zero-network local dev (NFR-9.5) — logs instead of sending, matching gateway/providers/stub.ts and gateway/embeddings/stub.ts. */
export class StubEmailProvider implements EmailProviderAdapter {
  async send(message: CanonicalOutboundMessage): Promise<DeliveryReceipt> {
    const messageId = `<stub-${randomUUID()}@cx-platform.local>`;
    console.log(`[stub-email] would send to conversation ${message.conversationId} (Message-ID ${messageId}):\n${message.text}`);
    return { ok: true, detail: messageId };
  }
}
