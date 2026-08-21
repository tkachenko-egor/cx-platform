import type { CanonicalOutboundMessage, DeliveryReceipt } from "../types";

/**
 * Mirrors src/gateway/types.ts's ProviderAdapter shape deliberately — same
 * "one interface, swap the implementation" pattern, one layer up.
 */
export interface EmailProviderAdapter {
  send(message: CanonicalOutboundMessage): Promise<DeliveryReceipt>;
}
