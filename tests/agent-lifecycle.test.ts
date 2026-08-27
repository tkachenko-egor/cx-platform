import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { ensureConversation, processInboundTurn, DEFAULT_AGENT_KEY } from "../src/channel/turn";

beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

/** Same scripted-provider pattern as tests/orchestrator.test.ts, with a public call counter so tests can assert the model was (or wasn't) invoked. */
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

function usage(costUsd = 0) {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd };
}

const OK_RESPONSE: ChatResponse = { content: "Happy to help with that.", toolCalls: [], stopReason: "end_turn", usage: usage() };

async function baseSetup(script: ChatResponse[]) {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  seedCommerceBusinessData(db, tenant.id);
  const embeddings = new StubEmbeddingProvider();
  await ingestKnowledgeBase(db, tenant, embeddings);

  const provider = new ScriptedProvider(script);
  await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  const gateway = new ModelGateway({ db, providers: { scripted: provider } });

  return { db, tenant, gateway, embeddings, provider };
}

describe("agent_status gates routing (Phase 7 M1)", () => {
  it("ensureConversation refuses to start a new conversation on a paused agent", async () => {
    const { db, tenant } = await baseSetup([OK_RESPONSE]);
    const agentDefs = new AgentDefRepository(db, tenant);
    await agentDefs.publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co"), modelAlias: "support-main", agentStatus: "active" }); // v1
    await agentDefs.publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co"), modelAlias: "support-main", agentStatus: "paused" }); // v2

    await expect(ensureConversation({ db }, tenant, undefined, "widget")).rejects.toThrow(/not active/);
  });

  it("lets an already-running conversation keep going on its pinned version after the agent is later paused", async () => {
    const { db, tenant, gateway, embeddings } = await baseSetup([OK_RESPONSE, OK_RESPONSE]);
    const agentDefs = new AgentDefRepository(db, tenant);
    await agentDefs.publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co"), modelAlias: "support-main", agentStatus: "active" }); // v1

    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    const first = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "hi" });
    expect(first.state).toBe("bot_active");

    // Republish as paused — the conversation above is already pinned to v1.
    await agentDefs.publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co"), modelAlias: "support-main", agentStatus: "paused" }); // v2

    const second = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "still there?" });
    expect(second.state).toBe("bot_active");
    expect(second.assistantText).toBe("Happy to help with that.");
  });

  it("escalates instead of handing off to a paused specialist", async () => {
    const { db, tenant, gateway, embeddings } = await baseSetup([
      { content: "", toolCalls: [{ id: "h1", name: "handoff_to_agent", arguments: { target: "billing-specialist", reason: "Billing", summary: "Billing question" } }], stopReason: "tool_use", usage: usage() },
    ]);
    const agentDefs = new AgentDefRepository(db, tenant);
    await agentDefs.publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co"), modelAlias: "support-main", agentStatus: "active", handoffTargets: ["billing-specialist"] });
    await agentDefs.publish({ key: "billing-specialist", systemPrompt: buildCorePrompt("Fixture Retail Co"), modelAlias: "support-main", agentStatus: "paused" });

    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "billing question" });

    expect(result.state).toBe("awaiting_human");
    expect(result.escalationReasons).toContain("target_agent_unavailable");
  });
});

describe("per-conversation cost ceiling (Phase 7 M2)", () => {
  it("lets a turn that pushes spend over the ceiling finish, then escalates the next turn before calling the model again", async () => {
    const { db, tenant, gateway, embeddings, provider } = await baseSetup([{ ...OK_RESPONSE, usage: usage(10) }, OK_RESPONSE]);
    await new AgentDefRepository(db, tenant).publish({
      key: DEFAULT_AGENT_KEY,
      systemPrompt: buildCorePrompt("Fixture Retail Co"),
      modelAlias: "support-main",
      costCeilingUsd: 5,
    });

    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    const first = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "hi" });
    expect(first.state).toBe("bot_active");
    expect(provider.calls).toBe(1);

    const second = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "one more question" });
    expect(second.state).toBe("awaiting_human");
    expect(second.escalationReasons).toContain("cost_ceiling_exceeded");
    // The model must never have been called for the second turn — the ceiling check short-circuits before that.
    expect(provider.calls).toBe(1);

    expect((await new ConversationRepository(db, tenant).get(conversation.id))?.state).toBe("awaiting_human");
  });
});
