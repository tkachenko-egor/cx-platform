import "dotenv/config";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";

/**
 * Per the requirements doc's own risk mitigation: "resist building the
 * admin UI before the runtime works — configure via seed scripts until the
 * shape is stable." This creates one demo tenant with a model alias bound
 * to Anthropic (falling back to the local stub) and one published agent.
 */
const db = createDb();

const tenants = new TenantRepository(db);
let tenant = tenants.getBySlug("demo");
if (!tenant) {
  tenant = tenants.create("Demo Tenant", "demo");
  console.log(`Created tenant "${tenant.slug}" (${tenant.id})`);
} else {
  console.log(`Tenant "${tenant.slug}" already exists (${tenant.id})`);
}

const modelAliases = new ModelAliasRepository(db, tenant);
modelAliases.upsert({
  alias: "support-main",
  provider: "anthropic",
  model: "claude-sonnet-5",
  fallbackChain: [{ provider: "stub", model: "stub-a" }],
});
console.log('Model alias "support-main" -> anthropic:claude-sonnet-5 (fallback: stub:stub-a)');

const agents = new AgentDefRepository(db, tenant);
const agent = agents.publish({
  key: "support-generalist",
  systemPrompt: "You are a helpful customer support agent. Be concise and honest about what you don't know.",
  modelAlias: "support-main",
});
console.log(`Published agent "${agent.key}" v${agent.version}`);
