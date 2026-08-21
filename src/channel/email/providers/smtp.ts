import nodemailer, { type Transporter } from "nodemailer";
import type { EmailProviderAdapter } from "../provider";
import type { CanonicalOutboundMessage, DeliveryReceipt } from "../../types";

export interface SmtpEmailProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  fromAddress: string;
}

/** FR-3.15: outbound send with correct threading headers and a per-tenant from-address. */
export class SmtpEmailProvider implements EmailProviderAdapter {
  private readonly transport: Transporter;
  private readonly fromAddress: string;

  constructor(config: SmtpEmailProviderConfig) {
    this.transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
    this.fromAddress = config.fromAddress;
  }

  async send(message: CanonicalOutboundMessage): Promise<DeliveryReceipt> {
    const to = message.metadata?.to as string | undefined;
    if (!to) return { ok: false, detail: "missing recipient address" };
    const subject = (message.metadata?.subject as string | undefined) ?? "Re: your message";
    const inReplyTo = message.metadata?.inReplyTo as string | undefined;

    try {
      const info = await this.transport.sendMail({
        from: this.fromAddress,
        to,
        subject,
        text: message.text,
        inReplyTo,
        references: inReplyTo ? [inReplyTo] : undefined,
      });
      return { ok: true, detail: info.messageId };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
