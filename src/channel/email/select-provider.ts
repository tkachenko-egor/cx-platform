import { StubEmailProvider } from "./providers/stub";
import { SmtpEmailProvider } from "./providers/smtp";
import type { EmailProviderAdapter } from "./provider";

/** One source of truth for SMTP env config — used by the inbound-email route and by auth notifications (invites/password resets). */
export function selectEmailProvider(): EmailProviderAdapter {
  const host = process.env.SMTP_HOST;
  if (!host) return new StubEmailProvider();
  return new SmtpEmailProvider({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER ?? "", pass: process.env.SMTP_PASS ?? "" },
    fromAddress: process.env.SMTP_FROM ?? "support@example.com",
  });
}
