import type Database from "better-sqlite3";
import type { TenantContext } from "../tenancy/context";
import { ToolCallRepository } from "../db/repositories/tool-repository";
import type { ToolDefinition } from "../gateway/types";
import { lookupOrderInputSchema, lookupOrderToolDef, runLookupOrder } from "./amarelle/lookup-order";
import { searchProductsInputSchema, searchProductsToolDef, runSearchProducts } from "./amarelle/search-products";
import { checkReturnEligibilityInputSchema, checkReturnEligibilityToolDef, runCheckReturnEligibility } from "./amarelle/check-return-eligibility";

export interface ToolSpec {
  key: string;
  description: string;
  inputSchema: Record<string, unknown>;
  writeFlag: boolean;
  parse: (args: unknown) => unknown;
  run: (db: Database.Database, tenant: TenantContext, args: unknown) => Record<string, unknown>;
}

/**
 * FR-8.1: the tool registry. Handlers are code (this module); tool_defs
 * rows (written by scripts/seed.ts via registerToolDefs below) carry the
 * schema/write-flag/approval-policy metadata the admin surface reads.
 * Every tool here is read-only this phase — see the Phase 1 plan for why.
 */
const REGISTRY: Record<string, ToolSpec> = {
  [lookupOrderToolDef.key]: {
    key: lookupOrderToolDef.key,
    description: lookupOrderToolDef.description,
    inputSchema: lookupOrderToolDef.inputSchema,
    writeFlag: false,
    parse: (args) => lookupOrderInputSchema.parse(args),
    run: (db, tenant, args) => runLookupOrder(db, tenant, args as ReturnType<typeof lookupOrderInputSchema.parse>),
  },
  [searchProductsToolDef.key]: {
    key: searchProductsToolDef.key,
    description: searchProductsToolDef.description,
    inputSchema: searchProductsToolDef.inputSchema,
    writeFlag: false,
    parse: (args) => searchProductsInputSchema.parse(args),
    run: (db, tenant, args) => runSearchProducts(db, tenant, args as ReturnType<typeof searchProductsInputSchema.parse>),
  },
  [checkReturnEligibilityToolDef.key]: {
    key: checkReturnEligibilityToolDef.key,
    description: checkReturnEligibilityToolDef.description,
    inputSchema: checkReturnEligibilityToolDef.inputSchema,
    writeFlag: false,
    parse: (args) => checkReturnEligibilityInputSchema.parse(args),
    run: (db, tenant, args) => runCheckReturnEligibility(db, tenant, args as ReturnType<typeof checkReturnEligibilityInputSchema.parse>),
  },
};

export function allToolSpecs(): ToolSpec[] {
  return Object.values(REGISTRY);
}

/** Converts an agent's tool_ids allowlist into the gateway's canonical ToolDefinition shape. */
export function toGatewayToolDefinitions(toolKeys: string[]): ToolDefinition[] {
  return toolKeys
    .map((key) => REGISTRY[key])
    .filter((spec): spec is ToolSpec => Boolean(spec))
    .map((spec) => ({ name: spec.key, description: spec.description, parameters: spec.inputSchema }));
}

/**
 * FR-8.9: tool errors come back as { ok: false, error }, never a thrown
 * exception the model can't recover from. FR-8.10: every call is logged
 * regardless of outcome.
 */
export function executeTool(db: Database.Database, tenant: TenantContext, runId: string, toolKey: string, args: unknown): Record<string, unknown> {
  const spec = REGISTRY[toolKey];
  const start = Date.now();
  let result: Record<string, unknown>;
  let status: "ok" | "error" = "ok";

  try {
    if (!spec) throw new Error(`Unknown tool: ${toolKey}`);
    const parsed = spec.parse(args);
    result = spec.run(db, tenant, parsed);
    if ((result as { ok?: unknown }).ok === false) status = "error";
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    status = "error";
  }

  const latencyMs = Date.now() - start;
  try {
    new ToolCallRepository(db, tenant).record({ runId, toolKey, arguments: (args ?? {}) as Record<string, unknown>, result, status, latencyMs });
  } catch {
    // Logging must never break the tool loop.
  }

  return result;
}
