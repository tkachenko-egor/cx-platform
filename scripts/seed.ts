import "dotenv/config";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { ToolDefRepository } from "../src/db/repositories/tool-repository";
import { seedAmarelleBusinessData } from "../src/tools/amarelle/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { allToolSpecs } from "../src/tools/registry";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { OpenAiEmbeddingProvider } from "../src/gateway/embeddings/openai";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";

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

  const toolDefs = new ToolDefRepository(db, tenant);
  for (const spec of allToolSpecs()) {
    toolDefs.upsert({ key: spec.key, description: spec.description, inputSchema: spec.inputSchema, writeFlag: spec.writeFlag, approvalPolicy: "auto" });
  }
  console.log(`Registered ${allToolSpecs().length} tool defs`);

  const embeddings = process.env.OPENAI_API_KEY ? new OpenAiEmbeddingProvider(process.env.OPENAI_API_KEY) : new StubEmbeddingProvider();
  if (!process.env.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY not set — using the zero-network stub embedding provider (retrieval will work but isn't semantically meaningful).");
  }
  const { ingested, skipped } = await ingestKnowledgeBase(db, tenant, embeddings);
  console.log(`KB ingest: ${ingested.length} article(s) (re-)embedded, ${skipped.length} unchanged`);

  const agents = new AgentDefRepository(db, tenant);
  const agent = agents.publish({
    key: "support-generalist",
    systemPrompt: buildCorePrompt(tenant.name),
    modelAlias: "support-main",
    toolIds: ["lookup_order", "search_products", "check_return_eligibility"],
    kbScope: { audience: ["customer"] },
  });
  console.log(`Published agent "${agent.key}" v${agent.version}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
