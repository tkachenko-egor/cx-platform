import { cookies } from "next/headers";
import { getDb } from "../../../../../src/db/client";
import { getPlatformAdminSessionUser } from "../../../../../src/auth/platform-admin-lookup";
import { destroySession, SESSION_COOKIE } from "../../../../../src/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const db = getDb();
  const found = await getPlatformAdminSessionUser(db);
  if (found) {
    await destroySession(db, found.tenant);
  } else {
    (await cookies()).delete(SESSION_COOKIE);
  }
  return Response.json({ ok: true });
}
