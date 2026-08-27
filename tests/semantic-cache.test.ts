import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { SemanticCacheRepository } from "../src/db/repositories/semantic-cache-repository";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { runAgentTurn } from "../src/agents/runtime";
import { lookupCache, writeCache } from "../src/kb/semantic-cache";

beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

class ScriptedProvider implements ProviderAdapter {
  readonly provider = "scripted";
  calls = 0;
  constructor(private readonly script: ChatResponse[]) {}

  async chat(): Promise<ChatResponse> {
    return this.next();
  }

  async chatStream(_model: string, _request: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse> {
    const response = this.next();
    if (response.content) onDelta(response.content);
    return response;
  }

  private next(): ChatResponse {
    const response = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    return response;
  }
}

function usage() {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 };
}

describe("semantic cache module (src/kb/semantic-cache.ts)", () => {
  it("misses when the cache is empty", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();

    const hit = await lookupCache(db, tenant, "support-generalist", "Where is my order?", embeddings);
    expect(hit).toBeUndefined();
  });

  it("hits on an identical query after a write, and records the hit", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();

    await writeCache(db, tenant, "support-generalist", "Where is my order?", "It shipped yesterday.", [{ docId: "doc-a", title: "Shipping" }], embeddings);

    const hit = await lookupCache(db, tenant, "support-generalist", "Where is my order?", embeddings);
    expect(hit).toEqual({ responseText: "It shipped yesterday.", citableDocs: [{ docId: "doc-a", title: "Shipping" }] });

    const entries = new SemanticCacheRepository(db, tenant).listByAgent("support-generalist");
    expect(entries[0].hitCount).toBe(1);
    expect(entries[0].lastHitAt).toBeTruthy();
  });

  it("misses for a dissimilar query even though the cache has entries", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();

    await writeCache(db, tenant, "support-generalist", "Where is my order?", "It shipped yesterday.", [], embeddings);

    const hit = await lookupCache(db, tenant, "support-generalist", "Can I get a refund on a broken pair of headphones?", embeddings);
    expect(hit).toBeUndefined();
  });

  it("scopes cache entries by agent key — an entry for one agent never hits for another", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();

    await writeCache(db, tenant, "billing-specialist", "Where is my order?", "It shipped yesterday.", [], embeddings);

    const hit = await lookupCache(db, tenant, "support-generalist", "Where is my order?", embeddings);
    expect(hit).toBeUndefined();
  });
});

describe("semantic caching wired into runAgentTurn (Phase 2 M3b)", () => {
  async function setup(providerScript: ChatResponse[], semanticCacheEnabled: boolean) {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
    seedCommerceBusinessData(db, tenant.id);
    const embeddings = new StubEmbeddingProvider();
    await ingestKnowledgeBase(db, tenant, embeddings);

    await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
    const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider(providerScript) } });

    const agent = await new AgentDefRepository(db, tenant).publish({
      key: "support-generalist",
      systemPrompt: buildCorePrompt("Fixture Retail Co"),
      modelAlias: "support-main",
      toolIds: [],
      kbScope: { audience: ["customer"] },
      semanticCacheEnabled,
    });

    return { db, tenant, gateway, embeddings, agent };
  }

  const OK_RESPONSE: ChatResponse = { content: "Happy to help with that.", toolCalls: [], stopReason: "end_turn", usage: usage() };

  it("never attempts a cache lookup when the agent has not opted in", async () => {
    const { db, tenant, gateway, embeddings, agent } = await setup([OK_RESPONSE, OK_RESPONSE], false);

    await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", agent, [], "What's your return policy?");
    const result2 = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-2", agent, [], "What's your return policy?");

    // Both turns hit the model — no cache write happened since the agent never opted in.
    expect(result2.assistantText).toBe("Happy to help with that.");
    expect(new SemanticCacheRepository(db, tenant).listByAgent("support-generalist")).toHaveLength(0);
  });

  it("writes to the cache after a plain answered turn, then serves a repeat of the same question from cache", async () => {
    const { db, tenant, gateway, embeddings, agent } = await setup([OK_RESPONSE, { content: "THIS SHOULD NEVER BE SEEN", toolCalls: [], stopReason: "end_turn", usage: usage() }], true);

    const first = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", agent, [], "What's your return policy?");
    expect(first.assistantText).toBe("Happy to help with that.");
    expect(new SemanticCacheRepository(db, tenant).listByAgent("support-generalist")).toHaveLength(1);

    const second = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-2", agent, [], "What's your return policy?");
    // Served from cache — the second scripted response (which would prove a model call happened) never surfaces.
    expect(second.assistantText).toBe("Happy to help with that.");
  });

  it("does not write to the cache when the turn called a tool", async () => {
    const toolResponse: ChatResponse = {
      content: "",
      toolCalls: [{ id: "c1", name: "search_products", arguments: { query: "headphones" } }],
      stopReason: "tool_use",
      usage: usage(),
    };
    const { db, tenant, gateway, embeddings } = await setup([toolResponse, OK_RESPONSE], true);
    const agentWithTool = await new AgentDefRepository(db, tenant).publish({
      key: "support-generalist",
      systemPrompt: buildCorePrompt("Fixture Retail Co"),
      modelAlias: "support-main",
      toolIds: ["search_products"],
      kbScope: { audience: ["customer"] },
      semanticCacheEnabled: true,
    });

    await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", agentWithTool, [], "Do you have wireless headphones?");

    expect(new SemanticCacheRepository(db, tenant).listByAgent("support-generalist")).toHaveLength(0);
  });

  it("skips the cache lookup entirely for a severe-symptom message, even with a matching cached entry", async () => {
    const { db, tenant, gateway, embeddings, agent } = await setup(
      [{ content: "Please stop using it and seek medical attention.", toolCalls: [], stopReason: "end_turn", usage: usage() }],
      true,
    );

    // Seed the cache directly with a (deliberately wrong-for-this-case) cached reply for this exact text —
    // if the severity scan didn't gate the cache read, this is what would come back instead of a fresh model call.
    await writeCache(db, tenant, "support-generalist", "My lips are swelling after using this", "Cached reply that must never be served for this message.", [], embeddings);

    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", agent, [], "My lips are swelling after using this");
    expect(result.assistantText).toBe("Please stop using it and seek medical attention.");
    expect(result.escalationReasons).toContain("severe_symptom");
  });
});
