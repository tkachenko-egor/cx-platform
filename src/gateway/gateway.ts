import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { ModelAliasRepository, type ModelAlias } from "../db/repositories/model-alias-repository";
import { LlmCallRepository } from "../db/repositories/llm-call-repository";
import type { TenantContext } from "../tenancy/context";
import { emitTrace } from "../tracing/trace";
import { GatewayError, type ChatRequest, type ChatResponse, type GatewayErrorType, type ProviderAdapter } from "./types";

export interface ModelGatewayDeps {
  db: Database.Database;
  providers: Record<string, ProviderAdapter>;
}

/** FR-5.7: which error types trigger a fallback attempt vs. fail immediately. */
const RETRYABLE: GatewayErrorType[] = ["RateLimited", "Timeout", "ProviderUnavailable"];

type Attempt = (provider: ProviderAdapter, model: string) => Promise<ChatResponse>;

/**
 * The model-agnostic entry point every agent calls through. It never sees
 * a provider SDK type; it only resolves a tenant's alias to a provider +
 * model, walks the fallback chain, and records usage/trace data.
 *
 * FR-5.6 exit criterion: change what an alias points to (ModelAliasRepository.upsert)
 * and the next chat()/chatStream() call picks it up — no code here changes.
 */
export class ModelGateway {
  constructor(private readonly deps: ModelGatewayDeps) {}

  async chat(tenant: TenantContext, aliasName: string, runId: string, request: ChatRequest): Promise<ChatResponse> {
    return this.runWithFallback(tenant, aliasName, runId, (provider, model) => provider.chat(model, request));
  }

  /** Same fallback/tracing/usage behavior as chat(), but streams text deltas via onDelta as they arrive. */
  async chatStream(tenant: TenantContext, aliasName: string, runId: string, request: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse> {
    return this.runWithFallback(tenant, aliasName, runId, async (provider, model) => {
      if (provider.chatStream) return provider.chatStream(model, request, onDelta);
      const response = await provider.chat(model, request);
      if (response.content) onDelta(response.content);
      return response;
    });
  }

  private async runWithFallback(tenant: TenantContext, aliasName: string, runId: string, attempt: Attempt): Promise<ChatResponse> {
    const modelAliases = new ModelAliasRepository(this.deps.db, tenant);
    const llmCalls = new LlmCallRepository(this.deps.db, tenant);

    const alias = await modelAliases.getByAlias(aliasName);
    if (!alias) {
      throw new GatewayError("InvalidRequest", `Unknown model alias "${aliasName}" for tenant ${tenant.tenantId}`);
    }

    const chain: Array<Pick<ModelAlias, "provider" | "model">> = [{ provider: alias.provider, model: alias.model }, ...alias.fallbackChain];
    let lastError: GatewayError | undefined;

    for (const [index, target] of chain.entries()) {
      const fallbackUsed = index > 0;
      const provider = this.deps.providers[target.provider];
      const startedAt = Date.now();

      if (!provider) {
        lastError = new GatewayError("ProviderUnavailable", `No provider registered for "${target.provider}"`);
        emitTrace({ runId, tenantId: tenant.tenantId, type: "llm_call_skipped", data: { alias: aliasName, ...target, errorType: lastError.type } });
        continue;
      }

      try {
        const response = await attempt(provider, target.model);
        llmCalls.record({
          id: randomUUID(),
          runId,
          modelAlias: aliasName,
          provider: target.provider,
          model: target.model,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          cachedTokens: response.usage.cachedTokens,
          costUsd: response.usage.costUsd,
          latencyMs: Date.now() - startedAt,
          fallbackUsed,
          errorType: null,
        });
        emitTrace({
          runId,
          tenantId: tenant.tenantId,
          type: "llm_call",
          data: {
            alias: aliasName,
            ...target,
            fallbackUsed,
            latencyMs: Date.now() - startedAt,
            // A6: token/cost on the trace event so the exported GenAI span carries them (already persisted via llmCalls.record above).
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            costUsd: response.usage.costUsd,
          },
        });
        return response;
      } catch (err) {
        const gatewayError = err instanceof GatewayError ? err : new GatewayError("ProviderUnavailable", String(err));
        lastError = gatewayError;
        llmCalls.record({
          id: randomUUID(),
          runId,
          modelAlias: aliasName,
          provider: target.provider,
          model: target.model,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startedAt,
          fallbackUsed,
          errorType: gatewayError.type,
        });
        emitTrace({ runId, tenantId: tenant.tenantId, type: "llm_call_error", data: { alias: aliasName, ...target, errorType: gatewayError.type } });
        if (!RETRYABLE.includes(gatewayError.type)) {
          throw gatewayError;
        }
      }
    }

    throw lastError ?? new GatewayError("ProviderUnavailable", "All providers in the fallback chain failed");
  }
}
