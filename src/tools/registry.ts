import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { TenantContext } from "../tenancy/context";
import { ToolCallRepository, ToolDefRepository, type ToolDef } from "../db/repositories/tool-repository";
import { ToolApprovalRepository, type ToolApproval } from "../db/repositories/tool-approval-repository";
import type { ToolDefinition } from "../gateway/types";
import { lookupOrderInputSchema, lookupOrderToolDef, runLookupOrder } from "./commerce/lookup-order";
import { searchProductsInputSchema, searchProductsToolDef, runSearchProducts } from "./commerce/search-products";
import { checkReturnEligibilityInputSchema, checkReturnEligibilityToolDef, runCheckReturnEligibility } from "./commerce/check-return-eligibility";
import { cancelOrderInputSchema, cancelOrderToolDef, runCancelOrder } from "./commerce/cancel-order";
import { parseHttpToolConfig, runHttpTool } from "./http-tool-executor";
import { validateAgainstJsonSchema } from "./json-schema-lite";
import { emitTrace } from "../tracing/trace";

/** agent_defs.tool_settings: each tool owns its own slice, keyed by tool key. */
export type AgentToolSettings = Record<string, Record<string, unknown>>;

export interface ToolSpec {
  key: string;
  /** Admin-facing alias. Code tools carry a fixed one; HTTP tools take it from their tool_defs row. */
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  writeFlag: boolean;
  parse: (args: unknown) => unknown;
  run: (
    db: Database.Database,
    tenant: TenantContext,
    args: unknown,
    settings?: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * FR-8.1: the tool registry. Handlers are code (this module); tool_defs
 * rows (written by scripts/seed.ts via registerToolDefs below) carry the
 * schema/write-flag/approval-policy metadata the admin surface reads —
 * and that executeTool below actually enforces for write tools.
 */
const REGISTRY: Record<string, ToolSpec> = {
  [lookupOrderToolDef.key]: {
    key: lookupOrderToolDef.key,
    displayName: lookupOrderToolDef.displayName,
    description: lookupOrderToolDef.description,
    inputSchema: lookupOrderToolDef.inputSchema,
    writeFlag: false,
    parse: (args) => lookupOrderInputSchema.parse(args),
    run: (db, tenant, args, settings) => runLookupOrder(db, tenant, args as ReturnType<typeof lookupOrderInputSchema.parse>, settings),
  },
  [searchProductsToolDef.key]: {
    key: searchProductsToolDef.key,
    displayName: searchProductsToolDef.displayName,
    description: searchProductsToolDef.description,
    inputSchema: searchProductsToolDef.inputSchema,
    writeFlag: false,
    parse: (args) => searchProductsInputSchema.parse(args),
    run: (db, tenant, args, settings) => runSearchProducts(db, tenant, args as ReturnType<typeof searchProductsInputSchema.parse>, settings),
  },
  [checkReturnEligibilityToolDef.key]: {
    key: checkReturnEligibilityToolDef.key,
    displayName: checkReturnEligibilityToolDef.displayName,
    description: checkReturnEligibilityToolDef.description,
    inputSchema: checkReturnEligibilityToolDef.inputSchema,
    writeFlag: false,
    parse: (args) => checkReturnEligibilityInputSchema.parse(args),
    run: (db, tenant, args, settings) => runCheckReturnEligibility(db, tenant, args as ReturnType<typeof checkReturnEligibilityInputSchema.parse>, settings),
  },
  [cancelOrderToolDef.key]: {
    key: cancelOrderToolDef.key,
    displayName: cancelOrderToolDef.displayName,
    description: cancelOrderToolDef.description,
    inputSchema: cancelOrderToolDef.inputSchema,
    writeFlag: true,
    parse: (args) => cancelOrderInputSchema.parse(args),
    run: (db, tenant, args, settings) => runCancelOrder(db, tenant, args as ReturnType<typeof cancelOrderInputSchema.parse>, settings),
  },
};

export function allToolSpecs(): ToolSpec[] {
  return Object.values(REGISTRY);
}

/** Builds a ToolSpec for a DB-defined 'http' tool_defs row — no code handler, no redeploy needed to add one. */
function buildHttpToolSpec(def: ToolDef): ToolSpec {
  const config = parseHttpToolConfig(def.handlerConfig);
  return {
    key: def.key,
    displayName: def.displayName || def.key,
    description: def.description,
    inputSchema: def.inputSchema,
    writeFlag: def.writeFlag,
    parse: (args) => validateAgainstJsonSchema(def.inputSchema, args),
    run: (db, tenant, args) => runHttpTool(db, tenant, config, args as Record<string, unknown>),
  };
}

/** REGISTRY (code tools) first, then a DB lookup for admin-authored 'http' tools — so a new HTTP tool needs no code change or redeploy. */
function resolveToolSpec(db: Database.Database, tenant: TenantContext, toolKey: string): ToolSpec | undefined {
  const staticSpec = REGISTRY[toolKey];
  if (staticSpec) return staticSpec;
  const def = new ToolDefRepository(db, tenant).getByKey(toolKey);
  if (!def || def.type !== "http") return undefined;
  return buildHttpToolSpec(def);
}

/** Converts an agent's tool_ids allowlist into the gateway's canonical ToolDefinition shape. Unknown keys (a stale reference to a deleted tool) are silently dropped, same as a removed REGISTRY entry always has been. */
export function toGatewayToolDefinitions(db: Database.Database, tenant: TenantContext, toolKeys: string[]): ToolDefinition[] {
  const toolDefs = new ToolDefRepository(db, tenant);
  const defs: ToolDefinition[] = [];
  for (const key of toolKeys) {
    const staticSpec = REGISTRY[key];
    if (staticSpec) {
      defs.push({ name: staticSpec.key, description: staticSpec.description, parameters: staticSpec.inputSchema });
      continue;
    }
    const def = toolDefs.getByKey(key);
    if (def) defs.push({ name: def.key, description: def.description, parameters: def.inputSchema });
  }
  return defs;
}

/** A stable JSON encoding (sorted object keys) so the same logical arguments always hash the same, regardless of key order. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/**
 * FR-8.6: identity for "is this the same logical write request." Deliberately
 * keyed on conversation + arguments rather than the model's tool_call id —
 * a confirm_with_customer re-issue happens in a *different* model turn (and
 * so gets a fresh tool_call id), but is still the same request and must
 * still dedupe against the first attempt.
 */
function computeIdempotencyKey(conversationId: string, args: unknown): string {
  return createHash("sha256").update(`${conversationId}:${canonicalize(args)}`).digest("hex");
}

function logToolCall(
  db: Database.Database,
  tenant: TenantContext,
  input: { runId: string; toolKey: string; arguments: unknown; result: Record<string, unknown>; status: "ok" | "error"; latencyMs: number; idempotencyKey?: string },
): void {
  try {
    new ToolCallRepository(db, tenant).record({
      runId: input.runId,
      toolKey: input.toolKey,
      arguments: (input.arguments ?? {}) as Record<string, unknown>,
      result: input.result,
      status: input.status,
      latencyMs: input.latencyMs,
      idempotencyKey: input.idempotencyKey,
    });
    // A6: same event stream the LLM call uses, so an exported trace has a
    // span per tool call alongside the model span. Tool key + outcome +
    // latency only — never the arguments or the result.
    emitTrace({ runId: input.runId, tenantId: tenant.tenantId, type: "tool_call", data: { toolKey: input.toolKey, status: input.status, latencyMs: input.latencyMs } });
  } catch {
    // Logging must never break the tool loop.
  }
}

/** Runs an already-parsed call end to end: execute, classify ok/error, log. */
async function runAndLog(
  db: Database.Database,
  tenant: TenantContext,
  spec: ToolSpec,
  parsedArgs: unknown,
  logInput: { runId: string; toolKey: string; arguments: unknown; idempotencyKey?: string },
  settings?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  let result: Record<string, unknown>;
  let status: "ok" | "error" = "ok";
  try {
    result = await spec.run(db, tenant, parsedArgs, settings);
    if ((result as { ok?: unknown }).ok === false) status = "error";
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    status = "error";
  }

  logToolCall(db, tenant, { ...logInput, result, status, latencyMs: Date.now() - start });
  return result;
}

/**
 * FR-8.9: tool errors come back as { ok: false, error }, never a thrown
 * exception the model can't recover from. FR-8.10: every call is logged
 * regardless of outcome. FR-8.5/8.6: write tools are gated by their
 * tool_defs.approval_policy and never double-execute on a retry.
 */
export async function executeTool(
  db: Database.Database,
  tenant: TenantContext,
  conversationId: string,
  runId: string,
  toolKey: string,
  args: unknown,
  opts?: { sandbox?: boolean; toolSettings?: AgentToolSettings },
): Promise<Record<string, unknown>> {
  const spec = resolveToolSpec(db, tenant, toolKey);
  // Per-tool slice of the running agent's tool_settings; each tool applies
  // its own defaults when the agent hasn't configured anything.
  const settings = opts?.toolSettings?.[toolKey];
  if (!spec) {
    const result = { ok: false, error: `Unknown tool: ${toolKey}` };
    logToolCall(db, tenant, { runId, toolKey, arguments: args, result, status: "error", latencyMs: 0 });
    return result;
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = spec.parse(args);
  } catch (err) {
    const result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    logToolCall(db, tenant, { runId, toolKey, arguments: args, result, status: "error", latencyMs: 0 });
    return result;
  }

  if (!spec.writeFlag) {
    return runAndLog(db, tenant, spec, parsedArgs, { runId, toolKey, arguments: args }, settings);
  }

  // Phase 7 M2: a sandbox-environment agent never actually mutates anything —
  // short-circuits before idempotency/approval-policy handling entirely, so
  // no tool_approvals row is ever created for a sandbox agent's write calls.
  if (opts?.sandbox) {
    const result = { ok: true, dryRun: true, message: "This is a sandbox agent — the write action was simulated, nothing was actually changed." };
    logToolCall(db, tenant, { runId, toolKey, arguments: args, result, status: "ok", latencyMs: 0 });
    return result;
  }

  // --- write tool: idempotency + approval-policy gate (FR-8.5/8.6) ---
  const idempotencyKey = computeIdempotencyKey(conversationId, parsedArgs);
  const toolCalls = new ToolCallRepository(db, tenant);

  const prior = toolCalls.findByIdempotencyKey(toolKey, idempotencyKey);
  if (prior && prior.status === "ok") {
    return prior.result; // never double-execute a retry of the same logical request
  }

  const approvalPolicy = new ToolDefRepository(db, tenant).getByKey(toolKey)?.approvalPolicy ?? "auto";

  if (approvalPolicy === "auto") {
    return runAndLog(db, tenant, spec, parsedArgs, { runId, toolKey, arguments: args, idempotencyKey }, settings);
  }

  const approvals = new ToolApprovalRepository(db, tenant);
  const existing = approvals.getByIdempotencyKey(idempotencyKey);

  if (approvalPolicy === "confirm_with_customer") {
    // Only a *later* turn re-issuing the same request counts as the
    // customer having confirmed — re-calling within the same turn (the
    // model looping on its own, with no new customer input) must not.
    if (existing?.status === "pending" && existing.runId !== runId) {
      const result = await runAndLog(db, tenant, spec, parsedArgs, { runId, toolKey, arguments: args, idempotencyKey }, settings);
      approvals.markDecided(existing.id, "approved", null);
      return result;
    }
    if (!existing) {
      approvals.create({ runId, conversationId, toolKey, arguments: parsedArgs as Record<string, unknown>, idempotencyKey, policy: "confirm_with_customer" });
    }
    return { ok: false, needsConfirmation: true, message: "This needs the customer's explicit go-ahead before it happens — ask them, and only call this again once they've said yes." };
  }

  // require_human_approval
  if (existing?.status === "denied") {
    return { ok: false, denied: true, message: "A colleague reviewed this and did not approve it." };
  }
  if (!existing) {
    approvals.create({ runId, conversationId, toolKey, arguments: parsedArgs as Record<string, unknown>, idempotencyKey, policy: "require_human_approval" });
  }
  return { ok: false, needsApproval: true, message: "A colleague needs to approve this before it can happen. Let the customer know you've flagged it for review." };
}

/**
 * Executes a require_human_approval tool call once staff have approved it in
 * the desk (FR-8.5/8.10). Runs with each tool's default settings: the approval
 * row records the call, not which agent version raised it, so there's no
 * agent_defs.tool_settings slice to resolve here.
 */
export async function executeApprovedTool(db: Database.Database, tenant: TenantContext, approval: ToolApproval): Promise<Record<string, unknown>> {
  const spec = resolveToolSpec(db, tenant, approval.toolKey);
  if (!spec) return { ok: false, error: `Unknown tool: ${approval.toolKey}` };
  return runAndLog(db, tenant, spec, approval.arguments, { runId: approval.runId, toolKey: approval.toolKey, arguments: approval.arguments, idempotencyKey: approval.idempotencyKey });
}
