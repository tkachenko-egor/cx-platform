import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import type { AgentDef } from "../src/db/repositories/agent-def-repository";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { runAgentTurn } from "../src/agents/runtime";
import { detectCycle, appendToPath } from "../src/agents/loop-prevention";
import { buildCorePrompt } from "../src/agents/system-prompt";

beforeAll(async () => {
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
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  seedCommerceBusinessData(db, tenant.id);
  const embeddings = new StubEmbeddingProvider();
  await ingestKnowledgeBase(db, tenant, embeddings);

  const provider = new ScriptedProvider(providerScript);
  await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  const gateway = new ModelGateway({ db, providers: { scripted: provider } });

  return { db, tenant, gateway, embeddings, provider };
}

function specialistAgent(handoffTargets: string[]): AgentDef {
  return {
    id: "specialist-1",
    tenantId: "demo",
    key: "billing-specialist",
    version: 1,
    status: "published",
    systemPrompt: buildCorePrompt("Fixture Retail Co"),
    modelAlias: "support-main",
    toolIds: ["lookup_order"],
    kbScope: { audience: ["customer"] },
    handoffTargets,
    guardrails: {},
    skills: [],
    semanticCacheEnabled: false,
    nativeTools: {},
    quickReplies: [],
    displayName: "",
    avatarUrl: null,
    internalDescription: "",
    ownerUserId: null,
    tags: [],
    agentStatus: "active",
    environment: "production",
    changeNotes: "",
    temperature: null,
    maxOutputTokens: null,
    costCeilingUsd: null,
    persona: {},
    languageConfig: {},
    escalationConfig: {},
    conversationConfig: {},
    enabledChannels: [],
    businessHours: null,
    toolSettings: {},
  };
}

describe("loop prevention (FR-6.8)", () => {
  it("detects an immediate A->B->A cycle", async () => {
    const path = appendToPath(appendToPath(["support-generalist"], "billing-specialist"), "support-generalist");
    expect(detectCycle(path, "billing-specialist")).toBe(true);
  });

  it("does not flag genuinely fresh ground", async () => {
    const path = ["support-generalist", "billing-specialist"];
    expect(detectCycle(path, "technical-specialist")).toBe(false);
  });

  it("only looks within the recent window, not the entire history", async () => {
    const longAgoPath = ["billing-specialist", "a", "b", "c", "d", "e"];
    expect(detectCycle(longAgoPath, "billing-specialist")).toBe(false);
  });
});

describe("runAgentTurn — specialist mid-turn handoff (FR-6.7), bot-level: every agent can hand off, no separate router agent", () => {
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

    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", specialistAgent(["technical-specialist"]), [], "My app crashes on login, also where's my order ORD-100001?");

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
