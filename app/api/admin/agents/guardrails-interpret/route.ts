import { randomUUID } from "node:crypto";
import { getPlatformContext } from "../../../../../src/platform/context";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import { buildInterpretRequest, extractGuardrailPatch, mergeGuardrailPatch } from "../../../../../src/guardrails/interpret";
import type { AgentGuardrailConfig } from "../../../../../src/guardrails/types";

// better-sqlite3 needs the Node runtime, not edge.
export const runtime = "nodejs";

/**
 * Phase 3 M4 spike: "describe guardrails in plain language" — compiles free
 * text into the existing structured AgentGuardrailConfig via one forced
 * tool call (src/guardrails/interpret.ts). Doesn't persist anything itself: the
 * editor merges the returned config into its own guardrailsJson state, so
 * Save/Publish stays the only thing that writes to agent_defs. No
 * conversation/run rows created — llm_calls.run_id has no FK (unlike
 * conversation_id elsewhere), so a synthetic id is enough for cost/trace
 * logging to work.
 */
export async function POST(req: Request) {
  let body: { text?: string; modelAlias?: string; current?: AgentGuardrailConfig };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });
  if (text.length > 2000) return Response.json({ error: "text exceeds the 2000 character limit" }, { status: 400 });
  if (!body.modelAlias) return Response.json({ error: "modelAlias is required" }, { status: 400 });

  const { db, tenant, gateway } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  try {
    const response = await gateway.chat(tenant, body.modelAlias, randomUUID(), buildInterpretRequest(text));
    const patch = extractGuardrailPatch(response.toolCalls);
    const merged = mergeGuardrailPatch(body.current ?? {}, patch);
    return Response.json({ patch, merged });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not read that description" }, { status: 502 });
  }
}
