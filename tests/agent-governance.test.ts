import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository, type AgentDef } from "../src/db/repositories/agent-def-repository";
import { AgentPublishApprovalRepository } from "../src/db/repositories/agent-publish-approval-repository";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { runAgentTurn } from "../src/agents/runtime";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { scanForSevereSymptoms } from "../src/agents/escalation";
import { checkPiiLeakage } from "../src/guardrails/output";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";

/** Same scripted-provider pattern as tests/agent-runtime.test.ts. */
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

function usage() {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 };
}

beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

async function seededTenant() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
  return { db, tenant };
}

describe("agent_publish_approvals (Phase 8 M3)", () => {
  it("round-trips a pending request, then approving it publishes the exact requested config and removes it from the pending list", async () => {
    const { db, tenant } = await seededTenant();
    const users = new UserRepository(db, tenant);
    const supervisor = await users.create({ email: "supervisor@example.com", passwordHash: "x", role: "supervisor" });
    const admin = await users.create({ email: "admin@example.com", passwordHash: "x", role: "admin" });
    const agentDefs = new AgentDefRepository(db, tenant);
    const approvals = new AgentPublishApprovalRepository(db, tenant);

    const payload = { key: "billing-specialist", systemPrompt: buildCorePrompt("Fixture Retail Co") + " v-requested", modelAlias: "support-main", agentStatus: "active" as const, environment: "production" as const };
    const approval = await approvals.create({
      agentKey: "billing-specialist",
      requestedVersion: 1,
      requestedBy: supervisor.id,
      payload,
      fromStatus: "none",
      toStatus: "active",
      fromEnvironment: "none",
      toEnvironment: "production",
    });

    // Queuing a request must never itself publish anything.
    expect(await agentDefs.getLatestPublished("billing-specialist")).toBeUndefined();
    expect((await approvals.listPending()).map((a) => a.id)).toEqual([approval.id]);

    // Approving replays the requester's payload verbatim.
    const published = await agentDefs.publish((await approvals.get(approval.id))!.payload as unknown as Parameters<typeof agentDefs.publish>[0]);
    await approvals.markDecided(approval.id, "approved", admin.id);

    expect(published.systemPrompt).toBe(payload.systemPrompt);
    expect(published.agentStatus).toBe("active");
    expect(published.environment).toBe("production");
    expect((await agentDefs.getLatestPublished("billing-specialist"))?.version).toBe(1);
    expect(await approvals.listPending()).toHaveLength(0);
    expect((await approvals.get(approval.id))?.status).toBe("approved");
  });

  it("a rejected request never gets published and stays out of the pending list", async () => {
    const { db, tenant } = await seededTenant();
    const users = new UserRepository(db, tenant);
    const supervisor = await users.create({ email: "supervisor2@example.com", passwordHash: "x", role: "supervisor" });
    const admin = await users.create({ email: "admin2@example.com", passwordHash: "x", role: "admin" });
    const agentDefs = new AgentDefRepository(db, tenant);
    const approvals = new AgentPublishApprovalRepository(db, tenant);

    const approval = await approvals.create({
      agentKey: "technical-specialist",
      requestedVersion: 1,
      requestedBy: supervisor.id,
      payload: { key: "technical-specialist", systemPrompt: "x", modelAlias: "support-main", agentStatus: "active", environment: "production" },
      fromStatus: "none",
      toStatus: "active",
      fromEnvironment: "none",
      toEnvironment: "production",
    });

    await approvals.markDecided(approval.id, "rejected", admin.id);

    expect(await agentDefs.getLatestPublished("technical-specialist")).toBeUndefined();
    expect(await approvals.listPending()).toHaveLength(0);
    expect((await approvals.get(approval.id))?.status).toBe("rejected");
  });
});

describe("per-agent escalation keyword extension (Phase 8 M1)", () => {
  it("scans hit on an admin-added keyword the built-in list doesn't have, without disturbing the built-in defaults", async () => {
    const withoutExtra = scanForSevereSymptoms("my custom-brand-reaction is happening");
    expect(withoutExtra.hit).toBe(false);

    const withExtra = scanForSevereSymptoms("my custom-brand-reaction is happening", ["custom-brand-reaction"]);
    expect(withExtra.hit).toBe(true);
    expect(withExtra.matched).toBe("custom-brand-reaction");

    // The built-in defaults still fire on their own, unaffected by the extra list.
    expect(scanForSevereSymptoms("my throat feels tight", ["custom-brand-reaction"]).hit).toBe(true);
  });
});

describe("N failed attempts escalation (Phase 8 M1)", () => {
  it("escalates once consecutive tool-call errors reach the configured threshold, without waiting for ROUND_CAP", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
    await seedCommerceBusinessData(db, tenant.id);
    await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });

    // cancel_order on a Delivered order returns ok:false (a legitimate business "no" —
    // this codebase doesn't distinguish that from a real execution error, see runtime.ts's
    // consecutiveToolFailures comment).
    const DELIVERED_ORDER = "ORD-100001";
    const cancelAttempt = (id: string): ChatResponse => ({ content: "", toolCalls: [{ id, name: "cancel_order", arguments: { order_id: DELIVERED_ORDER } }], stopReason: "tool_use", usage: usage() });
    const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider([cancelAttempt("call-1"), cancelAttempt("call-2"), cancelAttempt("call-3")]) } });

    const agent: AgentDef = {
      id: "agent-1",
      tenantId: tenant.id,
      key: "support-generalist",
      version: 1,
      status: "published",
      systemPrompt: buildCorePrompt("Fixture Retail Co"),
      modelAlias: "support-main",
      toolIds: ["cancel_order"],
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
      escalationConfig: { nFailedAttempts: 2 },
      conversationConfig: {},
      enabledChannels: [],
      businessHours: null,
      toolSettings: {},
    };

    const result = await runAgentTurn({ db, gateway, embeddings: new StubEmbeddingProvider() }, tenant, "CONV-nfailed", "run-1", agent, [], "please cancel my order");

    expect(result.escalate).toBe(true);
    expect(result.escalationReasons).toContain("n_failed_attempts");
    // Only 2 rounds should have run (threshold hit on the 2nd), well short of ROUND_CAP (8) —
    // a 3rd scripted response was provided precisely so a test failure (no early break) would
    // surface as a wrong escalation reason rather than the ScriptedProvider silently repeating.
    expect(result.updatedHistory.filter((m) => m.role === "assistant")).toHaveLength(2);
  });
});

describe("PII redaction only takes effect in blockingMode (Phase 8 M2)", () => {
  const TOOL_RESULTS = "";

  it("mode 'block' (default) blocks the whole reply, same as before this phase", async () => {
    const result = checkPiiLeakage("Reach me at someone@example.com", TOOL_RESULTS);
    expect(result).toEqual({ blocked: true, reasons: ["unattributed_pii:email"] });
    expect(result.redactedText).toBeUndefined();
  });

  it("mode 'redact' masks the PII and returns unblocked with the redacted text", async () => {
    const result = checkPiiLeakage("Reach me at someone@example.com, thanks!", TOOL_RESULTS, "redact");
    expect(result.blocked).toBe(false);
    expect(result.reasons).toEqual(["unattributed_pii:email"]);
    expect(result.redactedText).toBe("Reach me at [redacted], thanks!");
  });

  it("PII sourced from this turn's own tool results is never flagged, in either mode", async () => {
    const toolResults = JSON.stringify({ email: "someone@example.com" });
    expect(checkPiiLeakage("Your order confirmation went to someone@example.com", toolResults, "block").blocked).toBe(false);
    expect(checkPiiLeakage("Your order confirmation went to someone@example.com", toolResults, "redact").blocked).toBe(false);
  });
});
