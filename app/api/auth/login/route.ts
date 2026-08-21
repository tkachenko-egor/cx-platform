import { getPlatformContext } from "../../../../src/platform/context";
import { UserRepository } from "../../../../src/db/repositories/user-repository";
import { verifyPassword } from "../../../../src/auth/password";
import { createSession } from "../../../../src/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) return Response.json({ error: "email and password are required" }, { status: 400 });

  const { db, tenant } = await getPlatformContext();
  const user = new UserRepository(db, tenant).getByEmail(email);
  if (!user || user.status !== "active" || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession(db, tenant, user.id);
  return Response.json({ ok: true, role: user.role });
}
