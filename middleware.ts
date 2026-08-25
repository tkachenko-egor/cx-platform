import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_SUBDOMAINS } from "./src/platform/reserved-subdomains";

/**
 * DB-free hostname routing only (better-sqlite3 is a native addon and
 * Next's Node-runtime middleware bundling isn't reliable enough to bet
 * tenant-existence checks on) — the reserved "platform" subdomain routes
 * to the platform-admin surface; everything else passes through to
 * `getPlatformContext()`, which does the real (DB-backed) tenant lookup.
 */
export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host")?.split(":")[0] ?? "";
  const firstLabel = hostname.split(".")[0];

  // DA-05: server-component layouts/pages have no built-in way to read the
  // path they're rendering for — stamping it onto a request header here
  // (still DB-free, matches this file's existing constraint) lets the
  // login-gate redirects below carry a `?next=` back through, instead of
  // always dropping the visitor on the same default landing page regardless
  // of what deep link they actually requested.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname + req.nextUrl.search);

  if (RESERVED_SUBDOMAINS.has(firstLabel) && !req.nextUrl.pathname.startsWith("/platform-admin") && !req.nextUrl.pathname.startsWith("/api/platform-admin")) {
    const url = req.nextUrl.clone();
    url.pathname = `/platform-admin${req.nextUrl.pathname === "/" ? "" : req.nextUrl.pathname}`;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
