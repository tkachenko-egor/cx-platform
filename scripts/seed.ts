import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { seedFixtures } from "../src/testing/seed-fixtures";
import { AnthropicProvider } from "../src/gateway/providers/anthropic";
import { StubProvider } from "../src/gateway/providers/stub";
import { OpenAiEmbeddingProvider } from "../src/gateway/embeddings/openai";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { hashPassword } from "../src/auth/password";
import type { ProviderAdapter } from "../src/gateway/types";
import type { ApprovalPolicy } from "../src/db/repositories/tool-repository";

/**
 * Per the requirements doc's own risk mitigation: "resist building the
 * admin UI before the runtime works — configure via seed scripts until the
 * shape is stable." Creates the fixture tenant (generic sample commerce
 * data), its model aliases, tool registry entries, KB, support-generalist +
 * specialist agent defs (src/testing/seed-fixtures.ts — shared with the eval
 * harness), and two distinct staff accounts kept deliberately separate:
 * the platform owner (manages every tenant via /platform-admin, lives in
 * its own reserved "platform" tenant, never a demo/mock one) and the
 * fixture tenant's own owner (logs into that one tenant's ordinary /admin
 * UI — ordinary tenant-scoped sessions can't cross into a different
 * tenant, so without this a freshly seeded DB would have no way to log
 * into the demo tenant's admin panel at all).
 */
async function main() {
  const db = createDb();

  const providers: Record<string, ProviderAdapter> = { stub: new StubProvider() };
  if (process.env.ANTHROPIC_API_KEY) providers.anthropic = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
  else console.log("ANTHROPIC_API_KEY not set — model aliases fall back to the zero-network stub provider.");

  const embeddings = process.env.OPENAI_API_KEY ? new OpenAiEmbeddingProvider(process.env.OPENAI_API_KEY) : new StubEmbeddingProvider();
  if (!process.env.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY not set — using the zero-network stub embedding provider (retrieval will work but isn't semantically meaningful).");
  }

  // FR-8.5: every tool defaults to auto; write tools that need a human or
  // customer in the loop are named here explicitly rather than inferred.
  const approvalPolicyOverrides: Record<string, ApprovalPolicy> = { cancel_order: "confirm_with_customer" };

  const { tenant } = await seedFixtures({
    db,
    providers,
    embeddings,
    approvalPolicyOverrides,
    supportMain: process.env.ANTHROPIC_API_KEY ? { provider: "anthropic", model: "claude-sonnet-5" } : undefined,
  });

  console.log(`Tenant "${tenant.slug}" ready (${tenant.id})`);
  console.log("Seeded business data, model aliases (one per catalog model, plus the support-main target), tool defs, KB, and support-generalist + billing/technical agent defs.");

  // The platform owner lives in its own reserved "platform" tenant (see
  // src/platform/reserved-subdomains.ts), never in a demo/mock tenant like
  // the one seedFixtures just built — that tenant is sample business data,
  // not an identity home for whoever administers the whole platform.
  const tenants = new TenantRepository(db);
  const platformTenant = tenants.getBySlug("platform") ?? tenants.create("Platform", "platform");

  const platformUsers = new UserRepository(db, platformTenant);
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
  const existingOwner = platformUsers.getByEmail(ownerEmail);
  if (!existingOwner) {
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(9).toString("base64url");
    const passwordHash = await hashPassword(password);
    const owner = platformUsers.create({ email: ownerEmail, passwordHash, role: "owner" });
    platformUsers.setPlatformAdmin(owner.id, true);
    console.log(`Seeded platform owner "${ownerEmail}" in the platform tenant — password: ${password} (set SEED_OWNER_PASSWORD to pin this)`);
  } else {
    if (!existingOwner.isPlatformAdmin) platformUsers.setPlatformAdmin(existingOwner.id, true);
    console.log(`Platform owner "${ownerEmail}" already exists`);
  }

  // Separate from the platform owner above: an ordinary owner of the demo
  // tenant itself, so `tenant.slug`.localhost:3000/login has something to
  // log into. Tenant-scoped sessions can't cross into a different tenant
  // (src/auth/session.ts), so the platform owner's credentials alone
  // wouldn't get you into this tenant's own /admin UI.
  const tenantUsers = new UserRepository(db, tenant);
  const tenantOwnerEmail = process.env.SEED_TENANT_OWNER_EMAIL ?? "admin@fixture-retail.demo";
  if (!tenantUsers.getByEmail(tenantOwnerEmail)) {
    const password = process.env.SEED_TENANT_OWNER_PASSWORD ?? randomBytes(9).toString("base64url");
    const passwordHash = await hashPassword(password);
    tenantUsers.create({ email: tenantOwnerEmail, passwordHash, role: "owner" });
    console.log(`Seeded "${tenant.slug}" tenant owner "${tenantOwnerEmail}" — password: ${password} (set SEED_TENANT_OWNER_PASSWORD to pin this)`);
  } else {
    console.log(`Tenant owner "${tenantOwnerEmail}" already exists`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
