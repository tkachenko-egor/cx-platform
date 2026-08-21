import type { EmailProviderAdapter } from "../channel/email/provider";

/**
 * Thin wrappers over the existing channel-email interface — a synthetic
 * conversationId is a legitimate reuse of EmailProviderAdapter.send(),
 * not a new transactional-email path.
 */
export async function sendInviteEmail(provider: EmailProviderAdapter, input: { to: string; tenantName: string; inviteUrl: string }): Promise<void> {
  await provider.send({
    conversationId: "system:invite",
    text: `You've been invited to join ${input.tenantName} on the CX Platform.\n\nAccept your invite: ${input.inviteUrl}`,
    metadata: { to: input.to, subject: `You're invited to ${input.tenantName}` },
  });
}

export async function sendPasswordResetEmail(provider: EmailProviderAdapter, input: { to: string; resetUrl: string }): Promise<void> {
  await provider.send({
    conversationId: "system:password-reset",
    text: `Reset your password: ${input.resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    metadata: { to: input.to, subject: "Reset your password" },
  });
}
