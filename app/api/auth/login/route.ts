import { getPlatformContext } from "../../../../src/platform/context";
import { UserRepository } from "../../../../src/db/repositories/user-repository";
import { verifyPassword } from "../../../../src/auth/password";
import { createSession } from "../../../../src/auth/session";
import { checkLoginAttempt, recordFailedLogin, clearLoginAttempts } from "../../../../src/auth/login-rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) return Response.json({ error: "email and password are required" }, { status: 400 });

  const { db, tenant } = await getPlatformContext();
  const rateLimitKey = `${tenant.id}:${email}`;
  const attempt = checkLoginAttempt(rateLimitKey);
  if (!attempt.ok) {
    return Response.json({ error: "Too many failed attempts — try again later" }, { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } });
  }

  const user = await new UserRepository(db, tenant).getByEmail(email);
  if (!user || user.status !== "active" || !(await verifyPassword(password, user.passwordHash))) {
    recordFailedLogin(rateLimitKey);
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  clearLoginAttempts(rateLimitKey);
  await createSession(db, tenant, user.id);
  return Response.json({ ok: true, role: user.role });
}
