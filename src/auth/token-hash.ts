import { createHash } from "node:crypto";

/** Shared by session/invite/password-reset tokens — only the hash is ever persisted, the raw token lives in a cookie or emailed link. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
