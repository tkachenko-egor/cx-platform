import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { seedAmarelleBusinessData } from "../src/tools/amarelle/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { runAgentTurn } from "../src/agents/runtime";
import { buildCorePrompt } from "../src/agents/system-prompt";
import type { AgentDef } from "../src/db/repositories/agent-def-repository";

beforeAll(() => {
  process.env.DEMO_DATE = "2026-08-21";
});

/** A provider that plays back a fixed sequence of responses, one per chat() call — lets the test script an exact tool-use round trip without a real model. */
class ScriptedProvider implements ProviderAdapter {
  readonly provider = "scripted";
  private calls = 0;
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

async function setup(providerScript: ChatResponse[]) {
  const db = createDb(":memory:");
  const tenant = new TenantRepository(db).create("Amarelle Botanique", "demo");
  seedAmarelleBusinessData(db, tenant.id);

  const embeddings = new StubEmbeddingProvider();
  await ingestKnowledgeBase(db, tenant, embeddings);

  new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider(providerScript) } });

  const agent: AgentDef = {
    id: "agent-1",
    tenantId: tenant.id,
    key: "support-generalist",
    version: 1,
    status: "published",
    systemPrompt: buildCorePrompt("Amarelle Botanique"),
    modelAlias: "support-main",
    toolIds: ["lookup_order", "search_products", "check_return_eligibility"],
    kbScope: { audience: ["customer"] },
    handoffTargets: [],
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
  };

  return { db, tenant, gateway, embeddings, agent };
}

describe("runAgentTurn", () => {
  it("runs a tool round trip, attaches the resulting card, and does not escalate on an ordinary lookup", async () => {
    const script: ChatResponse[] = [
      {
        content: "",
        toolCalls: [{ id: "call-1", name: "lookup_order", arguments: { order_id: "ORD-100001" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
      },
      {
        content: "Your order ORD-100001 is on its way.",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
      },
    ];
    const { db, tenant, gateway, embeddings, agent } = await setup(script);

    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", agent, [], "Where is my order ORD-100001?");

    expect(result.assistantText).toBe("Your order ORD-100001 is on its way.");
    expect(result.cards).toHaveLength(1);
    expect((result.cards[0] as { kind: string }).kind).toBe("order_status");
    expect(result.escalate).toBe(false);
    expect(result.updatedHistory).toHaveLength(4); // user, assistant(tool_use), tool, assistant(final)
  });

  it("escalates on a severe-symptom keyword before the model even needs to act on it", async () => {
    const script: ChatResponse[] = [
      { content: "I understand — please stop using the product.", toolCalls: [], stopReason: "end_turn", usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 } },
    ];
    const { db, tenant, gateway, embeddings, agent } = await setup(script);

    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-2", "run-2", agent, [], "My lips are swelling after using this");

    expect(result.escalate).toBe(true);
    expect(result.escalationReasons).toContain("severe_symptom");
  });

  it("escalates when check_return_eligibility resolves ELIGIBLE, since there is no write tool to complete it", async () => {
    const script: ChatResponse[] = [
      {
        content: "",
        toolCalls: [{ id: "call-1", name: "check_return_eligibility", arguments: { order_id: "ORD-100001", line_id: "LINE-5001", reason_code: "REACTION" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
      },
      {
        content: "You're eligible — a colleague will follow up to complete the return.",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
      },
    ];
    const { db, tenant, gateway, embeddings, agent } = await setup(script);

    const result = await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-3", "run-3", agent, [], "I had a reaction, I want to return it");

    expect(result.escalate).toBe(true);
    expect(result.escalationReasons).toContain("eligible_return");
  });
});
