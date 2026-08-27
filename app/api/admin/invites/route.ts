import { randomBytes } from "node:crypto";
import { getPlatformContext } from "../../../../src/platform/context";
import { UserInviteRepository } from "../../../../src/db/repositories/user-invite-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";
import { hashToken } from "../../../../src/auth/token-hash";
import { selectEmailProvider } from "../../../../src/channel/email/select-provider";
import { sendInviteEmail } from "../../../../src/auth/notifications";
import type { Role } from "../../../../src/auth/permissions";

export const runtime = "nodejs";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VALID_ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];

export async function GET() {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const invites = await new UserInviteRepository(db, tenant).listPending();
  return Response.json({ invites });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
  const email = body.email?.trim().toLowerCase();
  const role = body.role as Role | undefined;
  if (!email || !role || !VALID_ROLES.includes(role)) {
    return Response.json({ error: `email and a valid role (${VALID_ROLES.join(", ")}) are required` }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let inviter;
  try {
    inviter = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const invite = await new UserInviteRepository(db, tenant).create({ email, role, tokenHash: hashToken(token), invitedBy: inviter.id, expiresAt });

  const inviteUrl = `${req.headers.get("origin") ?? ""}/invite/${token}`;
  await sendInviteEmail(selectEmailProvider(), { to: email, tenantName: tenant.name, inviteUrl });

  return Response.json({ ok: true, invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt } });
}
