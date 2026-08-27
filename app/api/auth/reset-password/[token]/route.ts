import { getPlatformContext } from "../../../../../src/platform/context";
import { PasswordResetRepository } from "../../../../../src/db/repositories/password-reset-repository";
import { UserRepository } from "../../../../../src/db/repositories/user-repository";
import { hashToken } from "../../../../../src/auth/token-hash";
import { hashPassword } from "../../../../../src/auth/password";

export const runtime = "nodejs";

export async function POST(req: Request, context: RouteContext<"/api/auth/reset-password/[token]">) {
  const { token } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!body.password || body.password.length < 8) {
    return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  const resets = new PasswordResetRepository(db, tenant);
  const reset = await resets.getByTokenHash(hashToken(token));
  if (!reset || reset.usedAt || reset.expiresAt < new Date().toISOString()) {
    return Response.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
  }

  const users = new UserRepository(db, tenant);
  const user = await users.get(reset.userId);
  if (!user) return Response.json({ error: "This reset link is invalid or has expired" }, { status: 400 });

  const passwordHash = await hashPassword(body.password);
  await users.setPasswordHash(user.id, passwordHash);
  await resets.markUsed(reset.id);

  return Response.json({ ok: true });
}
