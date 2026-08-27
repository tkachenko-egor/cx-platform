import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { MessageRepository } from "../src/db/repositories/message-repository";
import { EventRepository } from "../src/db/repositories/event-repository";
import { ReviewQueueRepository } from "../src/db/repositories/review-queue-repository";
import { AgentExperimentRepository } from "../src/db/repositories/agent-experiment-repository";
import { RunRepository } from "../src/db/repositories/run-repository";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { processInboundTurn, ensureConversation, DEFAULT_AGENT_KEY } from "../src/channel/turn";
import { getOrCreateSession } from "../src/agents/sessions-store";

beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

/** Same scripted-provider pattern as tests/agent-runtime.test.ts — one response per chat() call. */
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
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  seedCommerceBusinessData(db, tenant.id);

  const embeddings = new StubEmbeddingProvider();
  await ingestKnowledgeBase(db, tenant, embeddings);

  await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider(providerScript) } });

  await new AgentDefRepository(db, tenant).publish({
    key: DEFAULT_AGENT_KEY,
    systemPrompt: buildCorePrompt("Fixture Retail Co"),
    modelAlias: "support-main",
    toolIds: ["lookup_order", "search_products", "check_return_eligibility"],
    kbScope: { audience: ["customer"] },
  });

  return { db, tenant, gateway, embeddings };
}

const OK_RESPONSE: ChatResponse = {
  content: "Happy to help with that.",
  toolCalls: [],
  stopReason: "end_turn",
  usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
};

describe("processInboundTurn (channel-agnostic core)", () => {
  it("creates a conversation via ensureConversation, then runs a normal turn end to end", async () => {
    const { db, tenant, gateway, embeddings } = await setup([OK_RESPONSE]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "hi there" });

    expect(result.state).toBe("bot_active");
    expect(result.handoff).toBe(false);
    expect(result.assistantText).toBe("Happy to help with that.");
    expect(result.assistantMessageId).toBeTruthy();

    const messages = await new MessageRepository(db, tenant).listByConversation(conversation.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("enqueues a review-queue item on a low-confidence retrieval, without escalating or touching conversation state (Phase 2 M5)", async () => {
    // Deliberately no KB ingested for this tenant — hybridSearch's
    // candidateChunks is empty, so bestScore is unambiguously 0 (below
    // DEFAULT_LOW_CONFIDENCE_THRESHOLD), independent of RRF's rank-based
    // scoring quirks or any real KB content's incidental keyword overlap.
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
    seedCommerceBusinessData(db, tenant.id);
    const embeddings = new StubEmbeddingProvider();
    await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
    const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider([OK_RESPONSE]) } });
    await new AgentDefRepository(db, tenant).publish({
      key: DEFAULT_AGENT_KEY,
      systemPrompt: buildCorePrompt("Fixture Retail Co"),
      modelAlias: "support-main",
      kbScope: { audience: ["customer"] },
    });

    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "hi there" });

    expect(result.state).toBe("bot_active");
    expect(result.handoff).toBe(false);

    const pending = await new ReviewQueueRepository(db, tenant).listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].conversationId).toBe(conversation.id);
    expect(pending[0].reason).toBe("low_kb_confidence");
  });

  it("pins the version an A/B-tested conversation was assigned, surviving later turns and experiment changes (Phase 2 M6a)", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
    seedCommerceBusinessData(db, tenant.id);
    const embeddings = new StubEmbeddingProvider();
    await ingestKnowledgeBase(db, tenant, embeddings);

    await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
    const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider([OK_RESPONSE, OK_RESPONSE]) } });

    const agentDefs = new AgentDefRepository(db, tenant);
    await agentDefs.publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co") + " v1", modelAlias: "support-main", toolIds: [] }); // v1
    await agentDefs.publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co") + " v2", modelAlias: "support-main", toolIds: [] }); // v2

    const experiments = new AgentExperimentRepository(db, tenant);
    const experiment = await experiments.create({ agentKey: DEFAULT_AGENT_KEY, variantAVersion: 1, variantBVersion: 2, trafficSplit: 0 }); // always A (v1) at creation time

    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "first message" });

    // Flip the experiment to always-B after the conversation was already assigned — a re-evaluation would now pick v2.
    await experiments.stop(experiment.id);
    await experiments.create({ agentKey: DEFAULT_AGENT_KEY, variantAVersion: 1, variantBVersion: 2, trafficSplit: 1 });

    await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "second message" });

    const runs = await new RunRepository(db, tenant).listByConversation(conversation.id);
    expect(runs.every((r) => r.agentVersion === 1)).toBe(true);
  });

  it("escalates and flips conversation state to awaiting_human on a severe-symptom keyword", async () => {
    const { db, tenant, gateway, embeddings } = await setup([
      { content: "Please stop using the product and see a doctor.", toolCalls: [], stopReason: "end_turn", usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 } },
    ]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "My lips are swelling after using this" });

    expect(result.handoff).toBe(true);
    expect(result.state).toBe("awaiting_human");
    expect(result.escalationReasons).toContain("severe_symptom");
    expect((await new ConversationRepository(db, tenant).get(conversation.id))?.state).toBe("awaiting_human");

    // FR-4.2: the transition into awaiting_human must be a logged event, not just a field mutation.
    const events = await new EventRepository(db, tenant).listByConversation(conversation.id);
    const stateChanged = events.filter((e) => e.type === "state_changed");
    expect(stateChanged.some((e) => e.payload.to === "awaiting_human")).toBe(true);
  });

  it("does not run the agent while a human is handling the conversation — just records the message for continuity", async () => {
    const { db, tenant, gateway, embeddings } = await setup([OK_RESPONSE]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    await new ConversationRepository(db, tenant).setState(conversation.id, "human_active");

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "still there?" });

    expect(result.handoff).toBe(true);
    expect(result.state).toBe("human_active");
    expect(result.assistantText).toBeUndefined();

    // The message is still persisted to the transcript even though the bot didn't answer.
    const messages = await new MessageRepository(db, tenant).listByConversation(conversation.id);
    expect(messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("hands off to a human once the per-conversation turn cap is hit, without calling the model", async () => {
    const { db, tenant, gateway, embeddings } = await setup([OK_RESPONSE]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    getOrCreateSession(conversation.id).turnCount = 60; // MAX_TURNS_PER_CONVERSATION in src/channel/rate-limit.ts

    const result = await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "one more thing" });

    expect(result.loopCapHit).toBe(true);
    expect(result.handoff).toBe(true);
    expect(result.state).toBe("awaiting_human");
    expect(result.assistantText).toMatch(/hand you to a colleague/);

    const events = await new EventRepository(db, tenant).listByConversation(conversation.id);
    expect(events.some((e) => e.type === "state_changed" && e.payload.to === "awaiting_human")).toBe(true);
  });

  it("threads channelMessageId onto the persisted inbound message when the caller supplies one", async () => {
    const { db, tenant, gateway, embeddings } = await setup([OK_RESPONSE]);
    const conversation = await ensureConversation({ db }, tenant, undefined, "email");

    await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "email body", channelMessageId: "<abc@example.com>" });

    const found = await new MessageRepository(db, tenant).findConversationIdByChannelMessageIds(["<abc@example.com>"]);
    expect(found).toBe(conversation.id);
  });
});
