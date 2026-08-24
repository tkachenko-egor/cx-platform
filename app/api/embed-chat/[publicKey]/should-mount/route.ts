import { getWidgetContext } from "../../../../../src/platform/widget-context";
import { matchesGlob } from "../../../../../src/core/url-glob";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Phase 9 M3: audience targeting — public.widget.js calls this before
 * creating the embed iframe at all, so a widget with urlPatterns configured
 * never mounts on a non-matching page. Always called (not just when rules
 * exist) — a fast indexed lookup, correctness for the configured case
 * matters more than shaving one request for the unconfigured common case.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/embed-chat/[publicKey]/should-mount">) {
  const { publicKey } = await ctx.params;
  const widget = getWidgetContext(publicKey);
  if (!widget) {
    return Response.json({ allowed: false }, { status: 404, headers: CORS_HEADERS });
  }

  const path = new URL(req.url).searchParams.get("path") ?? "/";
  const patterns = widget.widgetConfig.audienceRules.urlPatterns ?? [];
  const allowed = patterns.length === 0 || patterns.some((p) => matchesGlob(p, path));

  return Response.json({ allowed }, { headers: CORS_HEADERS });
}
