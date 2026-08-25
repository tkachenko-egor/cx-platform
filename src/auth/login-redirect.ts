import { headers } from "next/headers";

/**
 * DA-05: builds "/login?next=<path>" from the path middleware.ts stamps onto
 * the `x-pathname` request header — every login-gated page used to redirect
 * to a bare "/login" regardless of what was actually requested, so every
 * bookmark and shared link cost an extra navigation after signing in. Falls
 * back to a bare "/login" if the header is somehow missing.
 */
export async function loginRedirectPath(): Promise<string> {
  const path = (await headers()).get("x-pathname");
  return path ? `/login?next=${encodeURIComponent(path)}` : "/login";
}
