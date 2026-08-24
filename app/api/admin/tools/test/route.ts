import { getPlatformContext } from "../../../../../src/platform/context";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import { parseHttpToolConfig, runHttpTool } from "../../../../../src/tools/http-tool-executor";

export const runtime = "nodejs";

/**
 * Phase 9 M1: lets an admin validate an HTTP tool's request/auth/output-
 * mapping config before saving it — takes the form's current (possibly
 * unsaved) handlerConfig directly rather than a saved tool_defs row, and
 * calls runHttpTool directly. Deliberately bypasses executeTool's
 * idempotency/approval machinery (src/tools/registry.ts) — there's no
 * conversation here for any of that to be scoped to.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { handlerConfig?: Record<string, unknown>; sampleArgs?: Record<string, unknown> };
  if (!body.handlerConfig) {
    return Response.json({ error: "handlerConfig is required" }, { status: 400 });
  }

  let config;
  try {
    config = parseHttpToolConfig(body.handlerConfig);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const result = await runHttpTool(db, tenant, config, body.sampleArgs ?? {});
  return Response.json({ ok: true, result });
}
