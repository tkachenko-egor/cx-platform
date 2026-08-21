import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createDb } from "../src/db/client";
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
 * shape is stable." Creates the "demo" tenant (Amarelle Botanique's data),
 * its model aliases, tool registry entries, KB, router + specialist agent
 * defs (src/testing/seed-fixtures.ts — shared with the eval harness), and
 * a staff owner account.
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
    // NFR-1.2/FR-5.5: routing must not be heavy — a cheap model bound per-node, not global.
    triageFast: process.env.ANTHROPIC_API_KEY ? { provider: "anthropic", model: "claude-haiku-4-5-20251001" } : undefined,
  });

  console.log(`Tenant "${tenant.slug}" ready (${tenant.id})`);
  console.log("Seeded business data, model aliases (one per catalog model, plus the router/support-main targets), tool defs, KB, and router + billing/technical/support-generalist agent defs.");

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
