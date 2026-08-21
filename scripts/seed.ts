import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { ToolDefRepository } from "../src/db/repositories/tool-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { seedAmarelleBusinessData } from "../src/tools/amarelle/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { allToolSpecs } from "../src/tools/registry";
import type { ApprovalPolicy } from "../src/db/repositories/tool-repository";
import { buildCorePrompt, buildRouterPrompt } from "../src/agents/system-prompt";
import { OpenAiEmbeddingProvider } from "../src/gateway/embeddings/openai";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { hashPassword } from "../src/auth/password";

/**
 * Per the requirements doc's own risk mitigation: "resist building the
 * admin UI before the runtime works — configure via seed scripts until the
 * shape is stable." Creates the "demo" tenant (Amarelle Botanique's data,
 * per the Phase 1 plan), its model alias, its tool registry entries, its
 * KB, and one published agent bound to all three.
 */
async function main() {
  const db = createDb();

  const tenants = new TenantRepository(db);
  let tenant = tenants.getBySlug("demo");
  if (!tenant) {
    tenant = tenants.create("Amarelle Botanique", "demo");
    console.log(`Created tenant "${tenant.slug}" (${tenant.id})`);
  } else {
    console.log(`Tenant "${tenant.slug}" already exists (${tenant.id})`);
  }

  seedAmarelleBusinessData(db, tenant.id);
  console.log("Seeded business data (customers, orders, order_lines, products)");

  const modelAliases = new ModelAliasRepository(db, tenant);
  modelAliases.upsert({
    alias: "support-main",
    provider: "anthropic",
    model: "claude-sonnet-5",
    fallbackChain: [{ provider: "stub", model: "stub-a" }],
  });
  console.log('Model alias "support-main" -> anthropic:claude-sonnet-5 (fallback: stub:stub-a)');

  // NFR-1.2/FR-5.5: routing must not be heavy — a cheap model bound per-node, not global.
  modelAliases.upsert({
    alias: "triage-fast",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    fallbackChain: [{ provider: "stub", model: "stub-a" }],
  });
  console.log('Model alias "triage-fast" -> anthropic:claude-haiku-4-5-20251001 (fallback: stub:stub-a)');

  // FR-8.5: every tool defaults to auto; write tools that need a human or
  // customer in the loop are named here explicitly rather than inferred.
  const APPROVAL_POLICY_OVERRIDES: Record<string, ApprovalPolicy> = { cancel_order: "confirm_with_customer" };

  const toolDefs = new ToolDefRepository(db, tenant);
  for (const spec of allToolSpecs()) {
    toolDefs.upsert({
      key: spec.key,
      description: spec.description,
      inputSchema: spec.inputSchema,
      writeFlag: spec.writeFlag,
      approvalPolicy: APPROVAL_POLICY_OVERRIDES[spec.key] ?? "auto",
    });
  }
  console.log(`Registered ${allToolSpecs().length} tool defs`);

  const embeddings = process.env.OPENAI_API_KEY ? new OpenAiEmbeddingProvider(process.env.OPENAI_API_KEY) : new StubEmbeddingProvider();
  if (!process.env.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY not set — using the zero-network stub embedding provider (retrieval will work but isn't semantically meaningful).");
  }
  const { ingested, skipped } = await ingestKnowledgeBase(db, tenant, embeddings);
  console.log(`KB ingest: ${ingested.length} article(s) (re-)embedded, ${skipped.length} unchanged`);

  // FR-6.1/6.6: router + specialists, all agent_defs rows. support-generalist
  // doubles as the catch-all/returns specialist the router falls back to.
  const agents = new AgentDefRepository(db, tenant);

  const generalist = agents.publish({
    key: "support-generalist",
    systemPrompt: buildCorePrompt(tenant.name),
    modelAlias: "support-main",
    toolIds: ["lookup_order", "search_products", "check_return_eligibility", "cancel_order"],
    kbScope: { audience: ["customer"] },
    handoffTargets: ["billing-specialist", "technical-specialist"],
  });
  console.log(`Published agent "${generalist.key}" v${generalist.version}`);

  const billing = agents.publish({
    key: "billing-specialist",
    systemPrompt: `# SPECIALTY\nYou handle billing, payments, charges and refund-status questions. Hand off anything outside that scope to the right specialist rather than guessing.\n\n${buildCorePrompt(tenant.name)}`,
    modelAlias: "support-main",
    toolIds: ["lookup_order", "check_return_eligibility", "cancel_order"],
    kbScope: { audience: ["customer"] },
    handoffTargets: ["technical-specialist", "support-generalist"],
  });
  console.log(`Published agent "${billing.key}" v${billing.version}`);

  const technical = agents.publish({
    key: "technical-specialist",
    systemPrompt: `# SPECIALTY\nYou handle product defects, technical order problems and troubleshooting. Hand off anything outside that scope to the right specialist rather than guessing.\n\n${buildCorePrompt(tenant.name)}`,
    modelAlias: "support-main",
    toolIds: ["lookup_order", "search_products"],
    kbScope: { audience: ["customer"] },
    handoffTargets: ["billing-specialist", "support-generalist"],
  });
  console.log(`Published agent "${technical.key}" v${technical.version}`);

  const router = agents.publish({
    key: "router",
    systemPrompt: buildRouterPrompt(tenant.name, [
      { key: "billing-specialist", description: "Payments, charges, refund status, invoices" },
      { key: "technical-specialist", description: "Product defects, app/website issues, technical troubleshooting" },
      { key: "support-generalist", description: "Orders, shipping, returns, product questions, and anything else" },
    ]),
    modelAlias: "triage-fast",
    toolIds: [],
    kbScope: {},
    handoffTargets: ["billing-specialist", "technical-specialist", "support-generalist"],
  });
  console.log(`Published agent "${router.key}" v${router.version}`);

  const users = new UserRepository(db, tenant);
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@amarelle.demo";
  if (!users.getByEmail(ownerEmail)) {
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(9).toString("base64url");
    const passwordHash = await hashPassword(password);
    users.create({ email: ownerEmail, passwordHash, role: "owner" });
    console.log(`Seeded staff owner "${ownerEmail}" — password: ${password} (set SEED_OWNER_PASSWORD to pin this)`);
  } else {
    console.log(`Staff owner "${ownerEmail}" already exists`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
