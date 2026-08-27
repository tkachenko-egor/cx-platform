import type Database from "better-sqlite3";
import { TenantRepository, type Tenant } from "../db/repositories/tenant-repository";
import { ModelAliasRepository } from "../db/repositories/model-alias-repository";
import { MODEL_CATALOG } from "../gateway/model-catalog";
import { AgentDefRepository } from "../db/repositories/agent-def-repository";
import { ToolDefRepository, type ApprovalPolicy } from "../db/repositories/tool-repository";
import { seedCommerceBusinessData } from "../tools/commerce/seed-data";
import { ingestKnowledgeBase } from "../kb/ingest";
import { allToolSpecs } from "../tools/registry";
import { buildCorePrompt } from "../agents/system-prompt";
import { ModelGateway } from "../gateway/gateway";
import type { ProviderAdapter } from "../gateway/types";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import { StubEmbeddingProvider } from "../gateway/embeddings/stub";

export interface ModelTarget {
  provider: string;
  model: string;
}

export interface SeedFixturesOptions {
  db: Database.Database;
  tenantName?: string;
  tenantSlug?: string;
  /** Providers keyed by name, e.g. { anthropic, stub } for real seeding or { scripted, stub } for evals/tests. */
  providers: Record<string, ProviderAdapter>;
  /** What the support-generalist/billing/technical agents' model alias resolves to. Defaults to a zero-network stub. The alias itself is named after this target's model id (Phase 6 M2). */
  supportMain?: ModelTarget;
  embeddings?: EmbeddingProvider;
  /** Overrides tool_defs.approval_policy per tool key; unlisted tools default to 'auto'. */
  approvalPolicyOverrides?: Record<string, ApprovalPolicy>;
  /** Skip publishing the billing/technical specialist agents — just support-generalist, matching the pre-M5/M6 single-agent shape. */
  skipSpecialists?: boolean;
}

export interface SeedFixturesResult {
  tenant: Tenant;
  gateway: ModelGateway;
  embeddings: EmbeddingProvider;
}

const DEFAULT_TARGET: ModelTarget = { provider: "stub", model: "stub-a" };

/**
 * The tenant/business-data/model-alias/tool-def/KB/agent-def bootstrap
 * shared by scripts/seed.ts (the real dev DB) and the eval harness
 * (scripts/eval/run-eval.ts) — one place instead of two copies drifting
 * apart. Individual *.test.ts files keep their own lighter-weight setup()
 * helpers where they only need a subset of this (out of scope to migrate
 * ~14 existing test files for this milestone).
 */
export async function seedFixtures(opts: SeedFixturesOptions): Promise<SeedFixturesResult> {
  const { db } = opts;
  const tenants = new TenantRepository(db);
  const slug = opts.tenantSlug ?? "fixture-retail";
  const tenant = tenants.getBySlug(slug) ?? tenants.create(opts.tenantName ?? "Fixture Retail Co", slug);

  seedCommerceBusinessData(db, tenant.id);

  const supportMain = opts.supportMain ?? DEFAULT_TARGET;

  const modelAliases = new ModelAliasRepository(db, tenant);
  // Phase 6 M2: alias name = the target model id itself (not a fixed
  // "support-main" role name), so the admin UI shows a real model name
  // instead of an opaque role string. opts.supportMain keeps working
  // exactly as before — a test injecting a "scripted" provider still gets
  // an alias pointed at it, just named after whatever model id it passed.
  const supportMainAlias = supportMain.model;
  modelAliases.upsert({ alias: supportMainAlias, provider: supportMain.provider, model: supportMain.model, fallbackChain: [DEFAULT_TARGET] });

  // Every catalog model gets its own alias too, so a freshly seeded
  // tenant's Agent Editor has every known model to pick from without an
  // admin hand-authoring one first.
  for (const entry of MODEL_CATALOG) {
    modelAliases.upsert({ alias: entry.model, provider: entry.provider, model: entry.model });
  }

  const toolDefs = new ToolDefRepository(db, tenant);
  for (const spec of allToolSpecs()) {
    toolDefs.upsert({
      key: spec.key,
      displayName: spec.displayName,
      description: spec.description,
      inputSchema: spec.inputSchema,
      writeFlag: spec.writeFlag,
      approvalPolicy: opts.approvalPolicyOverrides?.[spec.key] ?? "auto",
    });
  }

  const embeddings = opts.embeddings ?? new StubEmbeddingProvider();
  await ingestKnowledgeBase(db, tenant, embeddings);

  const agents = new AgentDefRepository(db, tenant);
  agents.publish({
    key: "support-generalist",
    systemPrompt: buildCorePrompt(tenant.name),
    toolIds: ["lookup_order", "search_products", "check_return_eligibility", "cancel_order"],
    modelAlias: supportMainAlias,
    kbScope: { audience: ["customer"] },
    // Bot-level routing: support-generalist is every new conversation's
    // entry point, and hands off to a specialist itself (via its own
    // handoff_to_agent tool) instead of a separate tenant-level router.
    handoffTargets: opts.skipSpecialists ? [] : ["billing-specialist", "technical-specialist"],
  });

  if (!opts.skipSpecialists) {
    agents.publish({
      key: "billing-specialist",
      systemPrompt: `# SPECIALTY\nYou handle billing, payments, charges and refund-status questions. Hand off anything outside that scope to the right specialist rather than guessing.\n\n${buildCorePrompt(tenant.name)}`,
      toolIds: ["lookup_order", "check_return_eligibility", "cancel_order"],
      modelAlias: supportMainAlias,
      kbScope: { audience: ["customer"] },
      handoffTargets: ["technical-specialist", "support-generalist"],
    });
    agents.publish({
      key: "technical-specialist",
      systemPrompt: `# SPECIALTY\nYou handle product defects, technical order problems and troubleshooting. Hand off anything outside that scope to the right specialist rather than guessing.\n\n${buildCorePrompt(tenant.name)}`,
      toolIds: ["lookup_order", "search_products"],
      modelAlias: supportMainAlias,
      kbScope: { audience: ["customer"] },
      handoffTargets: ["billing-specialist", "support-generalist"],
    });
  }

  const gateway = new ModelGateway({ db, providers: opts.providers });
  return { tenant, gateway, embeddings };
}
