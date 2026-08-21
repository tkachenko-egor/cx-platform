import { getPlatformContext } from "../../../../src/platform/context";
import { destroySession } from "../../../../src/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const { db, tenant } = await getPlatformContext();
  await destroySession(db, tenant);
  return Response.json({ ok: true });
}
