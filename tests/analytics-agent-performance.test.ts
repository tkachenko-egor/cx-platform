import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { EventRepository } from "../src/db/repositories/event-repository";
import { RunRepository } from "../src/db/repositories/run-repository";
import { LlmCallRepository } from "../src/db/repositories/llm-call-repository";
import { getAgentVolume, getContainmentRate, getEscalationReasonBreakdown, getLatencyPercentiles, getAgentVersionPerformance } from "../src/analytics/agent-performance";

async function setup() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  return { db, tenant };
}

function llmCall(runId: string, overrides: Partial<{ costUsd: number; latencyMs: number }> = {}) {
  return {
    id: crypto.randomUUID(),
    runId,
    modelAlias: "support-main",
    provider: "scripted",
    model: "scripted-1",
    promptTokens: 10,
    completionTokens: 5,
    cachedTokens: 0,
    costUsd: overrides.costUsd ?? 0.001,
    latencyMs: overrides.latencyMs ?? 100,
    fallbackUsed: false,
    errorType: null,
  };
}

describe("agent-performance analytics (Phase 2 M7a)", () => {
  it("getAgentVolume counts runs grouped by agent key", async () => {
    const { db, tenant } = await setup();
    const conversations = new ConversationRepository(db, tenant);
    const runs = new RunRepository(db, tenant);
    const c1 = await conversations.create({ channel: "widget", agentKey: "general" });
    await runs.start({ conversationId: c1.id, agentKey: "general", agentVersion: 1, trigger: "customer_message" });
    await runs.start({ conversationId: c1.id, agentKey: "general", agentVersion: 1, trigger: "customer_message" });
    await runs.start({ conversationId: c1.id, agentKey: "billing", agentVersion: 1, trigger: "customer_message" });

    const volume = await getAgentVolume(db, tenant);
    expect(volume).toEqual([
      { agentKey: "general", runCount: 2 },
      { agentKey: "billing", runCount: 1 },
    ]);
  });

  it("getContainmentRate treats never-escalated conversations as contained", async () => {
    const { db, tenant } = await setup();
    const conversations = new ConversationRepository(db, tenant);
    const events = new EventRepository(db, tenant);
    const contained = await conversations.create({ channel: "widget", agentKey: "general" });
    const escalated = await conversations.create({ channel: "widget", agentKey: "general" });
    await events.append({ conversationId: escalated.id, type: "escalated", payload: { reasons: ["human_request"] }, actor: "system" });

    const rate = await getContainmentRate(db, tenant);
    expect(rate).toEqual({ totalConversations: 2, containedConversations: 1, rate: 0.5 });
    expect(contained.id).not.toBe(escalated.id);
  });

  it("getEscalationReasonBreakdown tallies reasons across escalated events", async () => {
    const { db, tenant } = await setup();
    const conversations = new ConversationRepository(db, tenant);
    const events = new EventRepository(db, tenant);
    const c1 = await conversations.create({ channel: "widget", agentKey: "general" });
    const c2 = await conversations.create({ channel: "widget", agentKey: "general" });
    await events.append({ conversationId: c1.id, type: "escalated", payload: { reasons: ["human_request", "negative_sentiment"] }, actor: "system" });
    await events.append({ conversationId: c2.id, type: "escalated", payload: { reasons: ["human_request"] }, actor: "system" });

    const breakdown = await getEscalationReasonBreakdown(db, tenant);
    expect(breakdown).toEqual([
      { reason: "human_request", count: 2 },
      { reason: "negative_sentiment", count: 1 },
    ]);
  });

  it("getLatencyPercentiles sorts latencies and picks p50/p95, optionally scoped to one agent", async () => {
    const { db, tenant } = await setup();
    const conversations = new ConversationRepository(db, tenant);
    const runs = new RunRepository(db, tenant);
    const llmCalls = new LlmCallRepository(db, tenant);
    const c1 = await conversations.create({ channel: "widget", agentKey: "general" });
    const generalRun = await runs.start({ conversationId: c1.id, agentKey: "general", agentVersion: 1, trigger: "customer_message" });
    const billingRun = await runs.start({ conversationId: c1.id, agentKey: "billing", agentVersion: 1, trigger: "customer_message" });

    for (const ms of [100, 200, 300, 400, 500]) await llmCalls.record(llmCall(generalRun.id, { latencyMs: ms }));
    await llmCalls.record(llmCall(billingRun.id, { latencyMs: 9000 }));

    const overall = await getLatencyPercentiles(db, tenant);
    expect(overall.count).toBe(6);

    const generalOnly = await getLatencyPercentiles(db, tenant, { agentKey: "general" });
    expect(generalOnly).toEqual({ p50: 300, p95: 500, count: 5 });
  });

  it("getAgentVersionPerformance aggregates cost/latency/escalation rate per version", async () => {
    const { db, tenant } = await setup();
    const conversations = new ConversationRepository(db, tenant);
    const events = new EventRepository(db, tenant);
    const runs = new RunRepository(db, tenant);
    const llmCalls = new LlmCallRepository(db, tenant);

    const cA = await conversations.create({ channel: "widget", agentKey: "general" });
    const runA = await runs.start({ conversationId: cA.id, agentKey: "general", agentVersion: 1, trigger: "customer_message" });
    await llmCalls.record(llmCall(runA.id, { costUsd: 0.01, latencyMs: 100 }));

    const cB = await conversations.create({ channel: "widget", agentKey: "general" });
    const runB = await runs.start({ conversationId: cB.id, agentKey: "general", agentVersion: 2, trigger: "customer_message" });
    await llmCalls.record(llmCall(runB.id, { costUsd: 0.02, latencyMs: 200 }));
    await events.append({ conversationId: cB.id, type: "escalated", payload: { reasons: ["human_request"] }, actor: "system" });

    const perf = await getAgentVersionPerformance(db, tenant, "general");
    expect(perf).toEqual([
      { agentVersion: 1, runCount: 1, avgCostUsd: 0.01, avgLatencyMs: 100, escalationRate: 0 },
      { agentVersion: 2, runCount: 1, avgCostUsd: 0.02, avgLatencyMs: 200, escalationRate: 1 },
    ]);
  });
});
