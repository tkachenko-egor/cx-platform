import { getPlatformContext } from "../../../../../src/platform/context";
import { UserInviteRepository } from "../../../../../src/db/repositories/user-invite-repository";
import { UserRepository } from "../../../../../src/db/repositories/user-repository";
import { hashToken } from "../../../../../src/auth/token-hash";
import { hashPassword } from "../../../../../src/auth/password";
import { createSession } from "../../../../../src/auth/session";

export const runtime = "nodejs";

/** Accepts an invite (token in the URL, per the emailed link) and logs the new user straight in. */
export async function POST(req: Request, context: RouteContext<"/api/invites/[token]/accept">) {
  const { token } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!body.password || body.password.length < 8) {
    return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  const invites = new UserInviteRepository(db, tenant);
  const invite = invites.getByTokenHash(hashToken(token));
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date().toISOString()) {
    return Response.json({ error: "This invite link is invalid or has expired" }, { status: 400 });
  }

  const users = new UserRepository(db, tenant);
  if (users.getByEmail(invite.email)) {
    return Response.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await hashPassword(body.password);
  const user = users.create({ email: invite.email, passwordHash, role: invite.role });
  invites.markAccepted(invite.id);
  await createSession(db, tenant, user.id);

  return Response.json({ ok: true, role: user.role });
}
