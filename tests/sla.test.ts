import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { SlaPolicyRepository } from "../src/db/repositories/sla-policy-repository";
import { computeDueAt, startSlaClock, clearSlaClock } from "../src/core/sla";

beforeAll(() => {
  process.env.DEMO_DATETIME = "2026-08-21T10:00:00.000Z";
});

function setup() {
  const db = createDb(":memory:");
  const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
  const conversation = new ConversationRepository(db, tenant).create({ channel: "widget", agentKey: "support-generalist" });
  return { db, tenant, conversation };
}

describe("computeDueAt (pure)", () => {
  it("returns null when no policy is configured — an unconfigured tenant gets no SLA clock", () => {
    expect(computeDueAt(undefined)).toBeNull();
  });

  it("adds target_minutes to the from-timestamp", () => {
    const policy = { id: "p1", tenantId: "t1", priority: "normal" as const, targetMinutes: 30, appliesToChannel: null, createdAt: "2026-01-01T00:00:00.000Z" };
    const dueAt = computeDueAt(policy, "2026-08-21T10:00:00.000Z");
    expect(dueAt).toBe("2026-08-21T10:30:00.000Z");
  });

  it("defaults fromTimestamp to now() when omitted", () => {
    const policy = { id: "p1", tenantId: "t1", priority: "urgent" as const, targetMinutes: 15, appliesToChannel: null, createdAt: "2026-01-01T00:00:00.000Z" };
    expect(computeDueAt(policy)).toBe("2026-08-21T10:15:00.000Z"); // DEMO_DATETIME pinned above
  });
});

describe("SlaPolicyRepository.findForPriorityAndChannel", () => {
  it("prefers a channel-specific policy over a channel-agnostic one", () => {
    const { db, tenant } = setup();
    const policies = new SlaPolicyRepository(db, tenant);
    policies.create({ priority: "normal", targetMinutes: 60 });
    policies.create({ priority: "normal", targetMinutes: 20, appliesToChannel: "widget" });

    const found = policies.findForPriorityAndChannel("normal", "widget");
    expect(found?.targetMinutes).toBe(20);
  });

  it("falls back to the channel-agnostic policy when no channel-specific one exists", () => {
    const { db, tenant } = setup();
    const policies = new SlaPolicyRepository(db, tenant);
    policies.create({ priority: "urgent", targetMinutes: 10 });

    const found = policies.findForPriorityAndChannel("urgent", "email");
    expect(found?.targetMinutes).toBe(10);
  });

  it("returns undefined when nothing matches — the tenant simply has no SLA policy for this case", () => {
    const { db, tenant } = setup();
    const found = new SlaPolicyRepository(db, tenant).findForPriorityAndChannel("low", "widget");
    expect(found).toBeUndefined();
  });
});

describe("startSlaClock / clearSlaClock", () => {
  it("sets sla_due_at based on the matching policy, and clears it back to null", () => {
    const { db, tenant, conversation } = setup();
    const conversations = new ConversationRepository(db, tenant);
    const policies = new SlaPolicyRepository(db, tenant);
    policies.create({ priority: "normal", targetMinutes: 30 });

    startSlaClock(conversations, policies, conversation.id, "normal", "widget");
    expect(conversations.get(conversation.id)?.slaDueAt).toBe("2026-08-21T10:30:00.000Z");

    clearSlaClock(conversations, conversation.id);
    expect(conversations.get(conversation.id)?.slaDueAt).toBeNull();
  });

  it("leaves sla_due_at null when the tenant has no matching policy", () => {
    const { db, tenant, conversation } = setup();
    startSlaClock(new ConversationRepository(db, tenant), new SlaPolicyRepository(db, tenant), conversation.id, "normal", "widget");
    expect(new ConversationRepository(db, tenant).get(conversation.id)?.slaDueAt).toBeNull();
  });
});

describe("ConversationRepository.listSlaBreaching", () => {
  it("surfaces only awaiting_human conversations whose sla_due_at has passed", () => {
    const { db, tenant } = setup();
    const conversations = new ConversationRepository(db, tenant);

    const breaching = conversations.create({ channel: "widget", agentKey: "support-generalist" });
    conversations.setState(breaching.id, "awaiting_human");
    conversations.setSlaDueAt(breaching.id, "2026-08-21T09:00:00.000Z"); // in the past relative to "now" below

    const notYetDue = conversations.create({ channel: "widget", agentKey: "support-generalist" });
    conversations.setState(notYetDue.id, "awaiting_human");
    conversations.setSlaDueAt(notYetDue.id, "2026-08-21T12:00:00.000Z"); // in the future

    const noClock = conversations.create({ channel: "widget", agentKey: "support-generalist" });
    conversations.setState(noClock.id, "awaiting_human");

    const humanActiveButOverdue = conversations.create({ channel: "widget", agentKey: "support-generalist" });
    conversations.setState(humanActiveButOverdue.id, "human_active");
    conversations.setSlaDueAt(humanActiveButOverdue.id, "2026-08-21T09:00:00.000Z");

    const result = conversations.listSlaBreaching("2026-08-21T10:00:00.000Z");
    expect(result.map((c) => c.id)).toEqual([breaching.id]);
  });
});
