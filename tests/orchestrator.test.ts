import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { MessageRepository } from "../src/db/repositories/message-repository";
import { EventRepository } from "../src/db/repositories/event-repository";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { ensureConversation, processInboundTurn } from "../src/channel/turn";

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

/** No separate router agent: support-generalist is every conversation's entry point and routes via its own handoffTargets + handoff_to_agent tool, same mechanism a mid-conversation handoff uses. */
async function setup(script: ChatResponse[]) {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  seedCommerceBusinessData(db, tenant.id);
  const embeddings = new StubEmbeddingProvider();
  await ingestKnowledgeBase(db, tenant, embeddings);

  const provider = new ScriptedProvider(script);
  await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  const gateway = new ModelGateway({ db, providers: { scripted: provider } });

  const agents = new AgentDefRepository(db, tenant);
  await agents.publish({
    key: "support-generalist",
    systemPrompt: buildCorePrompt("Fixture Retail Co"),
    modelAlias: "support-main",
    toolIds: ["lookup_order"],
    kbScope: { audience: ["customer"] },
    handoffTargets: ["billing-specialist", "technical-specialist"],
  });
  await agents.publish({
    key: "billing-specialist",
    systemPrompt: buildCorePrompt("Fixture Retail Co"),
    modelAlias: "support-main",
    toolIds: ["lookup_order"],
    kbScope: { audience: ["customer"] },
    handoffTargets: ["technical-specialist", "support-generalist"],
  });
  await agents.publish({
    key: "technical-specialist",
    systemPrompt: buildCorePrompt("Fixture Retail Co"),
    modelAlias: "support-main",
    toolIds: ["lookup_order"],
    kbScope: { audience: ["customer"] },
    handoffTargets: ["billing-specialist", "support-generalist"],
  });

  return { db, tenant, gateway, embeddings, provider };
}

const HANDOFF_TO_BILLING: ChatResponse = {
  content: "",
  toolCalls: [{ id: "h0", name: "handoff_to_agent", arguments: { target: "billing-specialist", reason: "Billing question", summary: "Customer says they were charged twice" } }],
  stopReason: "tool_use",
  usage: usage(),
};

describe("orchestrator: entry agent -> specialist -> handback via processInboundTurn (bot-level routing, no separate router agent)", () => {
  it("routes a fresh conversation to the right specialist and persists the handoff", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      HANDOFF_TO_BILLING,
      { content: "I can see the double charge — let me fix that.", toolCalls: [], stopReason: "end_turn", usage: usage() },
    ]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "Why was I charged twice?" });

    expect(result.assistantText).toBe("I can see the double charge — let me fix that.");
    expect(result.state).toBe("bot_active");

    const updated = new ConversationRepository(db, tenant).get(conversation.id);
    expect(updated?.currentAgentId).toBe("billing-specialist");
    expect(updated?.metadata.agentPath).toEqual(["support-generalist", "billing-specialist"]);

    const events = new EventRepository(db, tenant).listByConversation(conversation.id);
    const handoffEvent = events.find((e) => e.type === "handoff");
    expect(handoffEvent?.payload).toMatchObject({ from: "support-generalist", to: "billing-specialist" });

    const messages = new MessageRepository(db, tenant).listByConversation(conversation.id, { includeInternal: true });
    expect(messages.some((m) => m.role === "handoff")).toBe(true);
  });

  it("hops again when the specialist itself requests a handoff mid-turn, and the receiving agent gets the structured package", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      HANDOFF_TO_BILLING,
      {
        content: "",
        toolCalls: [
          {
            id: "h1",
            name: "handoff_to_agent",
            arguments: { target: "technical-specialist", reason: "Actually a bug report", summary: "App crashes at checkout", instructions_for_receiving_agent: "Ask for OS version" },
          },
        ],
        stopReason: "tool_use",
        usage: usage(),
      },
      { content: "Sorry about the crash — what device and OS are you on?", toolCalls: [], stopReason: "end_turn", usage: usage() },
    ]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "My app crashes at checkout, also I think I was overcharged" });

    expect(result.assistantText).toBe("Sorry about the crash — what device and OS are you on?");

    const updated = new ConversationRepository(db, tenant).get(conversation.id);
    expect(updated?.currentAgentId).toBe("technical-specialist");
    expect(updated?.metadata.agentPath).toEqual(["support-generalist", "billing-specialist", "technical-specialist"]);

    const events = new EventRepository(db, tenant).listByConversation(conversation.id);
    const handoffEvents = events.filter((e) => e.type === "handoff");
    expect(handoffEvents).toHaveLength(2);
    expect(handoffEvents[1].payload).toMatchObject({ from: "billing-specialist", to: "technical-specialist", reason: "Actually a bug report" });
  });

  it("escalates to a human instead of ping-ponging when a specialist hands back to one already visited (A->B->C->B)", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      HANDOFF_TO_BILLING,
      { content: "", toolCalls: [{ id: "h1", name: "handoff_to_agent", arguments: { target: "technical-specialist", reason: "r1", summary: "s1" } }], stopReason: "tool_use", usage: usage() },
      { content: "", toolCalls: [{ id: "h2", name: "handoff_to_agent", arguments: { target: "billing-specialist", reason: "r2", summary: "s2" } }], stopReason: "tool_use", usage: usage() },
    ]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "Confusing multi-part question" });

    expect(result.state).toBe("awaiting_human");
    expect(result.escalationReasons).toContain("handoff_cycle_detected");
  });

  it("a plain single agent with no handoff targets just answers directly, no handoff overhead", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
    seedCommerceBusinessData(db, tenant.id);
    const embeddings = new StubEmbeddingProvider();
    await ingestKnowledgeBase(db, tenant, embeddings);

    const provider = new ScriptedProvider([{ content: "Happy to help.", toolCalls: [], stopReason: "end_turn", usage: usage() }]);
    await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
    const gateway = new ModelGateway({ db, providers: { scripted: provider } });
    await new AgentDefRepository(db, tenant).publish({
      key: "support-generalist",
      systemPrompt: buildCorePrompt("Fixture Retail Co"),
      modelAlias: "support-main",
      toolIds: [],
      kbScope: { audience: ["customer"] },
    });

    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "Hi" });

    expect(result.assistantText).toBe("Happy to help.");
    expect(new ConversationRepository(db, tenant).get(conversation.id)?.currentAgentId).toBe("support-generalist");
    expect(provider.calls).toBe(1); // one model call total — no separate routing turn
  });
});
