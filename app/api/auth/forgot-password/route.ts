import { randomBytes } from "node:crypto";
import { getPlatformContext } from "../../../../src/platform/context";
import { UserRepository } from "../../../../src/db/repositories/user-repository";
import { PasswordResetRepository } from "../../../../src/db/repositories/password-reset-repository";
import { hashToken } from "../../../../src/auth/token-hash";
import { selectEmailProvider } from "../../../../src/channel/email/select-provider";
import { sendPasswordResetEmail } from "../../../../src/auth/notifications";

export const runtime = "nodejs";

const RESET_TTL_MS = 60 * 60 * 1000; // 1h

/** Tenant-resolved via getPlatformContext() (subdomain) — a user's email is only unique within their tenant. Always 200s (enumeration avoidance). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email) return Response.json({ error: "email is required" }, { status: 400 });

  const { db, tenant } = await getPlatformContext();
  const user = new UserRepository(db, tenant).getByEmail(email);

  if (user && user.status === "active") {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
    new PasswordResetRepository(db, tenant).create({ userId: user.id, tokenHash: hashToken(token), expiresAt });

    const resetUrl = `${req.headers.get("origin") ?? ""}/reset-password/${token}`;
    await sendPasswordResetEmail(selectEmailProvider(), { to: email, resetUrl });
  }

  return Response.json({ ok: true });
}
