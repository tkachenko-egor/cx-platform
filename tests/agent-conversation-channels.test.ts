import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { AutoTagRuleRepository } from "../src/db/repositories/auto-tag-rule-repository";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ensureConversation, processInboundTurn, DEFAULT_AGENT_KEY } from "../src/channel/turn";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { pluckFields } from "../src/tools/http-tool-executor";
import { isWithinBusinessHours } from "../src/core/business-hours";
import { matchesGlob } from "../src/core/url-glob";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";

beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

describe("pluckFields (Phase 9 M1)", () => {
  it("plucks and renames nested fields, silently omitting missing paths", async () => {
    const data = { customer: { email: "a@example.com", id: 5 }, status: "ok" };
    expect(pluckFields(data, [{ path: "customer.email", as: "email" }, { path: "status" }, { path: "customer.missing" }])).toEqual({
      email: "a@example.com",
      status: "ok",
    });
  });

  it("returns an empty object for an empty mapping — callers only apply this when outputFields is non-empty", async () => {
    expect(pluckFields({ a: 1 }, [])).toEqual({});
  });
});

describe("isWithinBusinessHours (Phase 9 M3)", () => {
  it("is always open when disabled or unconfigured", async () => {
    expect(isWithinBusinessHours({ enabled: false, weeklyHours: [{ day: 1, start: "09:00", end: "17:00" }] }, "2026-08-24T20:00:00.000Z", "UTC")).toBe(true);
    expect(isWithinBusinessHours({ enabled: true, weeklyHours: [] }, "2026-08-24T20:00:00.000Z", "UTC")).toBe(true);
  });

  it("respects the configured weekly window in the given timezone", async () => {
    // 2026-08-24 is a Monday (day=1).
    const config = { enabled: true, weeklyHours: [{ day: 1, start: "09:00", end: "17:00" }] };
    expect(isWithinBusinessHours(config, "2026-08-24T12:00:00.000Z", "UTC")).toBe(true);
    expect(isWithinBusinessHours(config, "2026-08-24T20:00:00.000Z", "UTC")).toBe(false);
    expect(isWithinBusinessHours(config, "2026-08-25T12:00:00.000Z", "UTC")).toBe(false); // Tuesday, no rule
  });
});

describe("matchesGlob (Phase 9 M3)", () => {
  it("matches a literal path exactly and rejects everything else", async () => {
    expect(matchesGlob("/support", "/support")).toBe(true);
    expect(matchesGlob("/support", "/support/foo")).toBe(false);
  });

  it("treats * as a wildcard and escapes the rest of the pattern", async () => {
    expect(matchesGlob("/support/*", "/support/billing")).toBe(true);
    expect(matchesGlob("/support/*", "/other")).toBe(false);
    expect(matchesGlob("/a.b/*", "/aXb/anything")).toBe(false); // "." must be literal, not regex any-char
  });
});

function scriptedProvider(script: ChatResponse[], onRequest?: (request: ChatRequest) => void): ProviderAdapter {
  let calls = 0;
  return {
    provider: "scripted",
    async chat(_model, request) {
      onRequest?.(request);
      const response = script[Math.min(calls, script.length - 1)];
      calls++;
      return response;
    },
    async chatStream(_model: string, request: ChatRequest, onDelta: (text: string) => void) {
      onRequest?.(request);
      const response = script[Math.min(calls, script.length - 1)];
      calls++;
      if (response.content) onDelta(response.content);
      return response;
    },
  };
}

function usage() {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 };
}

async function baseSetup(script: ChatResponse[], onRequest?: (request: ChatRequest) => void) {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  seedCommerceBusinessData(db, tenant.id);
  const embeddings = new StubEmbeddingProvider();
  await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  const gateway = new ModelGateway({ db, providers: { scripted: scriptedProvider(script, onRequest) } });
  return { db, tenant, gateway, embeddings };
}

const OK_RESPONSE: ChatResponse = { content: "Happy to help with that.", toolCalls: [], stopReason: "end_turn", usage: usage() };

describe("auto-tagging merges instead of stomping (Phase 9 M4)", () => {
  it("keeps a previously-set agent-key tag (setTags) alongside a keyword-matched tag (addTags)", async () => {
    const { db, tenant, gateway, embeddings } = await baseSetup([OK_RESPONSE]);
    await new AgentDefRepository(db, tenant).publish({ key: DEFAULT_AGENT_KEY, systemPrompt: buildCorePrompt("Fixture Retail Co"), modelAlias: "support-main" });
    await new AutoTagRuleRepository(db, tenant).create({ tag: "billing", keywords: ["invoice"] });

    const conversations = new ConversationRepository(db, tenant);
    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    // Simulates what src/channel/turn.ts's entry-turn bookkeeping already does
    // via setTags — a full handoff setup isn't needed to prove the regression
    // this guards against: addTags below must not stomp this.
    await conversations.setTags(conversation.id, [DEFAULT_AGENT_KEY]);

    await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "I need my invoice" });

    const tags = (await conversations.get(conversation.id))?.tags ?? [];
    expect(tags).toContain(DEFAULT_AGENT_KEY);
    expect(tags).toContain("billing");
  });

  it("addTags itself unions rather than replacing", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
    const conversations = new ConversationRepository(db, tenant);
    const conversation = await conversations.create({ channel: "widget", agentKey: DEFAULT_AGENT_KEY });
    await conversations.setTags(conversation.id, ["support-generalist"]);
    await conversations.addTags(conversation.id, ["billing", "support-generalist"]); // duplicate should collapse

    expect((await conversations.get(conversation.id))?.tags.sort()).toEqual(["billing", "support-generalist"]);
  });
});

describe("memory scope 'recent' trims the model's replay context (Phase 9 M2)", () => {
  it("caps the non-system messages sent to the model at recentTurnLimit + the new message, instead of growing unbounded", async () => {
    let lastNonSystemCount = 0;
    const { db, tenant, gateway, embeddings } = await baseSetup([OK_RESPONSE, OK_RESPONSE, OK_RESPONSE], (request) => {
      lastNonSystemCount = request.messages.filter((m) => m.role !== "system").length;
    });
    await new AgentDefRepository(db, tenant).publish({
      key: DEFAULT_AGENT_KEY,
      systemPrompt: buildCorePrompt("Fixture Retail Co"),
      modelAlias: "support-main",
      conversationConfig: { memoryScope: "recent", recentTurnLimit: 2 },
    });

    const conversation = await ensureConversation({ db }, tenant, undefined, "widget");
    await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "first" });
    await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "second" });
    // Without trimming this 3rd turn would send 5 non-system messages
    // (user1, assistant1, user2, assistant2, user3) — trimming caps history
    // to the last 2 before adding the new user message, so 3.
    await processInboundTurn({ db, gateway, embeddings }, tenant, { conversationId: conversation.id, text: "third" });
    expect(lastNonSystemCount).toBe(3);
  });
});

describe("HTTP tool fallback message (Phase 9 M1)", () => {
  it("shows the fallback message to the model while keeping the technical detail", async () => {
    const { parseHttpToolConfig, runHttpTool } = await import("../src/tools/http-tool-executor");
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
    const config = parseHttpToolConfig({ url: "http://127.0.0.1:1/definitely-not-listening", method: "GET", fallbackMessage: "That lookup is temporarily unavailable." });

    const result = await runHttpTool(db, tenant, config, {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("That lookup is temporarily unavailable.");
    expect(typeof result.detail).toBe("string");
  });
});
