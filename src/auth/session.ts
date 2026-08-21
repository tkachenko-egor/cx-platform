import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import type Database from "better-sqlite3";
import type { Tenant } from "../db/repositories/tenant-repository";
import { SessionRepository } from "../db/repositories/session-repository";
import { UserRepository, type User } from "../db/repositories/user-repository";

const SESSION_COOKIE = "cx_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — staff shift-length session, re-login after

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Only ever called from a Route Handler (cookies() only allows writes there, not in Server Components). */
export async function createSession(db: Database.Database, tenant: Tenant, userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  new SessionRepository(db, tenant).create({ userId, tokenHash: hashToken(token), expiresAt: expiresAt.toISOString() });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(db: Database.Database, tenant: Tenant): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    new SessionRepository(db, tenant).deleteByTokenHash(hashToken(token));
  }
  jar.delete(SESSION_COOKIE);
}

/** Safe to call from Server Components (read-only cookie access) and Route Handlers alike. */
export async function getSessionUser(db: Database.Database, tenant: Tenant): Promise<User | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;

  const session = new SessionRepository(db, tenant).getByTokenHash(hashToken(token));
  if (!session) return undefined;
  if (session.expiresAt < new Date().toISOString()) return undefined;

  const user = new UserRepository(db, tenant).get(session.userId);
  if (!user || user.status !== "active") return undefined;
  return user;
}
