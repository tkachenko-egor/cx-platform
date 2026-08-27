import { getDb } from "../../../../../src/db/client";
import { findPlatformAdminUserByEmail } from "../../../../../src/auth/platform-admin-lookup";
import { verifyPassword } from "../../../../../src/auth/password";
import { createSession } from "../../../../../src/auth/session";
import { checkLoginAttempt, recordFailedLogin, clearLoginAttempts } from "../../../../../src/auth/login-rate-limit";

export const runtime = "nodejs";

/** Cross-tenant login — not gated by getPlatformContext() (the "platform" subdomain is a reserved, non-tenant slug). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) return Response.json({ error: "email and password are required" }, { status: 400 });

  const db = getDb();
  const rateLimitKey = `platform-admin:${email}`;
  const attempt = checkLoginAttempt(rateLimitKey);
  if (!attempt.ok) {
    return Response.json({ error: "Too many failed attempts — try again later" }, { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } });
  }

  const found = await findPlatformAdminUserByEmail(db, email);
  if (!found || found.user.status !== "active" || !(await verifyPassword(password, found.user.passwordHash))) {
    recordFailedLogin(rateLimitKey);
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  clearLoginAttempts(rateLimitKey);
  await createSession(db, found.tenant, found.user.id);
  return Response.json({ ok: true });
}
