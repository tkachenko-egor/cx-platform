import type Database from "better-sqlite3";
import { getDb } from "../db/client";
import { TenantRepository, type Tenant } from "../db/repositories/tenant-repository";
import { ModelGateway } from "../gateway/gateway";
import { AnthropicProvider } from "../gateway/providers/anthropic";
import { StubProvider } from "../gateway/providers/stub";
import { OpenAiEmbeddingProvider } from "../gateway/embeddings/openai";
import { StubEmbeddingProvider } from "../gateway/embeddings/stub";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import type { ProviderAdapter } from "../gateway/types";

export interface PlatformContext {
  db: Database.Database;
  tenant: Tenant;
  gateway: ModelGateway;
  embeddings: EmbeddingProvider;
}

let cached: PlatformContext | undefined;

/**
 * Phase 1 has exactly one real tenant ("demo") — this resolves it once per
 * process. Falls back to the zero-network stub provider/embeddings when
 * ANTHROPIC_API_KEY/OPENAI_API_KEY aren't set, via the gateway's own
 * fallback-chain mechanism (the seed script points "support-main" at
 * anthropic with a stub fallback) — so `npm run dev` works without any
 * secrets, per NFR-9.5.
 */
export function getPlatformContext(): PlatformContext {
  if (cached) return cached;

  const db = getDb();
  const tenant = new TenantRepository(db).getBySlug("demo");
  if (!tenant) {
    throw new Error('Tenant "demo" not found — run `npm run seed` first.');
  }

  const providers: Record<string, ProviderAdapter> = { stub: new StubProvider() };
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
  }

  const embeddings: EmbeddingProvider = process.env.OPENAI_API_KEY ? new OpenAiEmbeddingProvider(process.env.OPENAI_API_KEY) : new StubEmbeddingProvider();

  cached = { db, tenant, gateway: new ModelGateway({ db, providers }), embeddings };
  return cached;
}
