import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository, type AgentDef } from "../src/db/repositories/agent-def-repository";
import { seedAmarelleBusinessData } from "../src/tools/amarelle/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { runAgentTurn } from "../src/agents/runtime";
import { runRouterTurn } from "../src/agents/router";
import { detectCycle, appendToPath } from "../src/agents/loop-prevention";
import { buildCorePrompt } from "../src/agents/system-prompt";

beforeAll(() => {
  process.env.DEMO_DATE = "2026-08-21";
});

class ScriptedProvider implements ProviderAdapter {
  readonly provider = "scripted";
  calls = 0;
  lastRequest: ChatRequest | undefined;
  constructor(private readonly script: ChatResponse[]) {}

  async chat(_model: string, request: ChatRequest): Promise<ChatResponse> {
    this.lastRequest = request;
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

async function setup(providerScript: ChatResponse[]) {
  const db = createDb(":memory:");
  const tenant = new TenantRepository(db).create("Amarelle Botanique", "demo");
  seedAmarelleBusinessData(db, tenant.id);
  const embeddings = new StubEmbeddingProvider();
  await ingestKnowledgeBase(db, tenant, embeddings);

  const provider = new ScriptedProvider(providerScript);
  new ModelAliasRepository(db, tenant).upsert({ alias: "triage-fast", provider: "scripted", model: "scripted-1" });
  new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  const gateway = new ModelGateway({ db, providers: { scripted: provider } });

  return { db, tenant, gateway, embeddings, provider };
}

function routerAgent(handoffTargets: string[]): AgentDef {
  return {
    id: "router-1",
    tenantId: "demo",
    key: "router",
    version: 1,
    status: "published",
    systemPrompt: "You are a router. Always call route_to_agent.",
    modelAlias: "triage-fast",
    toolIds: [],
    kbScope: { audience: ["customer"] },
    handoffTargets,
    guardrails: {},
    skills: [],
    semanticCacheEnabled: false,
  };
}

function specialistAgent(handoffTargets: string[]): AgentDef {
  return {
    id: "specialist-1",
    tenantId: "demo",
    key: "billing-specialist",
    version: 1,
    status: "published",
    systemPrompt: buildCorePrompt("Amarelle Botanique"),
    modelAlias: "support-main",
    toolIds: ["lookup_order"],
    kbScope: { audience: ["customer"] },
    handoffTargets,
    guardrails: {},
    skills: [],
    semanticCacheEnabled: false,
  };
}

describe("runRouterTurn (FR-6.6: constrained enum, never free text)", () => {
  it("routes to the target the model names via the forced tool", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      { content: "", toolCalls: [{ id: "c1", name: "route_to_agent", arguments: { target: "technical-specialist" } }], stopReason: "tool_use", usage: usage() },
    ]);

    const result = await runRouterTurn({ db, gateway, embeddings }, tenant, "run-1", routerAgent(["billing-specialist", "technical-specialist"]), "My app keeps crashing");

    expect(result).toEqual({ target: "technical-specialist", confidence: "high" });
  });

  it("falls back to the first configured target when the model answers in free text instead of calling the tool", async () => {
    const { db, tenant, gateway, embeddings } = await setup([{ content: "I think this is a billing question.", toolCalls: [], stopReason: "end_turn", usage: usage() }]);

    const result = await runRouterTurn({ db, gateway, embeddings }, tenant, "run-1", routerAgent(["billing-specialist", "technical-specialist"]), "Why was I charged twice?");

    expect(result).toEqual({ target: "billing-specialist", confidence: "low" });
  });

  it("falls back when the model names a target outside the router's own enum", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      { content: "", toolCalls: [{ id: "c1", name: "route_to_agent", arguments: { target: "made-up-specialist" } }], stopReason: "tool_use", usage: usage() },
    ]);

    const result = await runRouterTurn({ db, gateway, embeddings }, tenant, "run-1", routerAgent(["billing-specialist", "technical-specialist"]), "Something");

    expect(result).toEqual({ target: "billing-specialist", confidence: "low" });
  });

  it("returns low confidence with an empty target when the router is misconfigured with no targets", async () => {
    const { db, tenant, gateway, embeddings } = await setup([]);
    const result = await runRouterTurn({ db, gateway, embeddings }, tenant, "run-1", routerAgent([]), "Anything");
    expect(result).toEqual({ target: "", confidence: "low" });
  });

  it("enriches the route_to_agent tool description with each target's skill tags (Phase 2 M3c)", async () => {
    const { db, tenant, gateway, embeddings, provider } = await setup([
      { content: "", toolCalls: [{ id: "c1", name: "route_to_agent", arguments: { target: "technical-specialist" } }], stopReason: "tool_use", usage: usage() },
    ]);
    new AgentDefRepository(db, tenant).publish({
      key: "technical-specialist",
      systemPrompt: "You handle technical issues.",
      modelAlias: "support-main",
      skills: ["app-crashes", "login-issues"],
    });
    new AgentDefRepository(db, tenant).publish({
      key: "billing-specialist",
      systemPrompt: "You handle billing.",
      modelAlias: "support-main",
      skills: ["refunds", "invoices"],
    });

    await runRouterTurn({ db, gateway, embeddings }, tenant, "run-1", routerAgent(["billing-specialist", "technical-specialist"]), "My app keeps crashing");

    const lastRequest = provider.lastRequest;
    const toolDescription = (lastRequest?.tools?.[0]?.parameters as { properties?: { target?: { description?: string } } })?.properties?.target?.description ?? "";
    expect(toolDescription).toContain("app-crashes");
    expect(toolDescription).toContain("refunds");
  });
});

describe("loop prevention (FR-6.8)", () => {
  it("detects an immediate A->B->A cycle", () => {
    const path = appendToPath(appendToPath(["router"], "billing-specialist"), "router");
    expect(detectCycle(path, "billing-specialist")).toBe(true);
  });

  it("does not flag genuinely fresh ground", () => {
    const path = ["router", "billing-specialist"];
    expect(detectCycle(path, "technical-specialist")).toBe(false);
  });

  it("only looks within the recent window, not the entire history", () => {
    const longAgoPath = ["billing-specialist", "a", "b", "c", "d", "e"];
    expect(detectCycle(longAgoPath, "billing-specialist")).toBe(false);
  });
});

describe("runAgentTurn — specialist mid-turn handoff (FR-6.7)", () => {
  it("captures a structured HandoffPackage instead of continuing the tool loop", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "handoff_to_agent",
            arguments: {
              target: "technical-specialist",
              reason: "Customer has a technical bug, not a billing issue",
              summary: "Customer reports the app crashes on login",
              instructions_for_receiving_agent: "Ask for their device and OS version",
              extracted_entities: '{"order_id":"ORD-100001"}',
            },
          },
        ],
        stopReason: "tool_use",
        usage: usage(),
      },
    ]);

    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", specialistAgent(["technical-specialist", "router"]), [], "My app crashes on login, also where's my order ORD-100001?");

    expect(result.handoffRequested).toBeDefined();
    expect(result.handoffRequested?.target).toBe("technical-specialist");
    expect(result.handoffRequested?.package.reason).toContain("technical bug");
    expect(result.handoffRequested?.package.extractedEntities).toEqual({ order_id: "ORD-100001" });
    // The handoff tool call itself never reaches the real tool registry (lookup_order was NOT invoked).
    expect(result.cards).toHaveLength(0);
  });

  it("a specialist with no handoff targets is never offered the handoff tool at all", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      { content: "Your order is on its way.", toolCalls: [], stopReason: "end_turn", usage: usage() },
    ]);
    const agentWithoutHandoff = { ...specialistAgent([]), toolIds: [] };

    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-2", "run-1", agentWithoutHandoff, [], "Hi");

    expect(result.handoffRequested).toBeUndefined();
  });
});
