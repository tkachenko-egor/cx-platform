import type Database from "better-sqlite3";
import { headers } from "next/headers";
import { getDb } from "../db/client";
import { TenantRepository, type Tenant } from "../db/repositories/tenant-repository";
import { ProviderCredentialRepository } from "../db/repositories/provider-credential-repository";
import { ModelGateway } from "../gateway/gateway";
import { AnthropicProvider } from "../gateway/providers/anthropic";
import { StubProvider } from "../gateway/providers/stub";
import { OpenAiEmbeddingProvider } from "../gateway/embeddings/openai";
import { StubEmbeddingProvider } from "../gateway/embeddings/stub";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import type { ProviderAdapter } from "../gateway/types";
import { RESERVED_SUBDOMAINS } from "./reserved-subdomains";

export interface PlatformContext {
  db: Database.Database;
  tenant: Tenant;
  gateway: ModelGateway;
  embeddings: EmbeddingProvider;
}

export { RESERVED_SUBDOMAINS };

export class TenantNotFoundError extends Error {
  constructor(public readonly slug: string) {
    super(`Tenant "${slug}" not found — run \`npm run seed\` first.`);
    this.name = "TenantNotFoundError";
  }
}

/**
 * First host label is the tenant slug (`tenant-slug.localhost:3000`, or
 * `tenant-slug.APP_DOMAIN` in production). A bare host with no subdomain
 * label — plain `localhost:3000`, or the bare `APP_DOMAIN` itself — has no
 * tenant to read, so it falls back to `DEFAULT_TENANT_SLUG`/"demo": this is
 * what keeps `npm run dev` zero-config (NFR-9.5) while
 * `tenant-slug.localhost:3000` opts into real multi-tenant resolution.
 */
export function resolveTenantSlugFromHost(host: string | null | undefined): string {
  const hostname = (host ?? "").split(":")[0].trim().toLowerCase();
  if (!hostname) return process.env.DEFAULT_TENANT_SLUG ?? "demo";

  const labels = hostname.split(".").filter(Boolean);
  const appDomainLabels = (process.env.APP_DOMAIN ?? "localhost").split(".").filter(Boolean);

  // Bare app domain (or bare "localhost" in dev) has no subdomain label.
  if (labels.length <= appDomainLabels.length) {
    return process.env.DEFAULT_TENANT_SLUG ?? "demo";
  }
  return labels[0];
}

const cacheBySlug = new Map<string, PlatformContext>();

/**
 * DB-stored key first, env var fallback — keeps `npm run dev` zero-config
 * (NFR-9.5) for tenants with no credential set yet, while a tenant admin's
 * Admin > API Keys entry (src/db/repositories/provider-credential-repository.ts)
 * takes precedence once one exists.
 */
function buildContext(tenant: Tenant, db: Database.Database): PlatformContext {
  const credentials = new ProviderCredentialRepository(db, tenant);
  const providers: Record<string, ProviderAdapter> = { stub: new StubProvider() };

  const anthropicKey = credentials.getActiveLlmKey("anthropic")?.decryptedKey ?? process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    providers.anthropic = new AnthropicProvider(anthropicKey);
  }

  const openaiKey = credentials.getActiveLlmKey("openai")?.decryptedKey ?? process.env.OPENAI_API_KEY;
  const embeddings: EmbeddingProvider = openaiKey ? new OpenAiEmbeddingProvider(openaiKey) : new StubEmbeddingProvider();

  return { db, tenant, gateway: new ModelGateway({ db, providers }), embeddings };
}

/**
 * Resolves the tenant for the current request from the `Host` header via
 * `next/headers`, so every existing zero-arg call site keeps working —
 * only `await` needed. Cached per-slug (not per-process) so multiple
 * tenants resolve independently within one running server.
 */
export async function getPlatformContext(): Promise<PlatformContext> {
  const headerList = await headers();
  const slug = resolveTenantSlugFromHost(headerList.get("host"));

  if (RESERVED_SUBDOMAINS.has(slug)) {
    throw new TenantNotFoundError(slug);
  }

  const cached = cacheBySlug.get(slug);
  if (cached) return cached;

  const db = getDb();
  const tenant = new TenantRepository(db).getBySlug(slug);
  if (!tenant) {
    throw new TenantNotFoundError(slug);
  }

  const context = buildContext(tenant, db);
  cacheBySlug.set(slug, context);
  return context;
}

/**
 * `cacheBySlug` holds the already-constructed ModelGateway/providers for the
 * life of the process. Without evicting a slug here, an admin setting a new
 * active provider_credentials row would silently have no effect until the
 * process restarted — call this right after a credential is set/deactivated.
 */
export function invalidatePlatformContext(slug: string): void {
  cacheBySlug.delete(slug);
}
