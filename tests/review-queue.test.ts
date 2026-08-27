import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { ReviewQueueRepository } from "../src/db/repositories/review-queue-repository";
import { UserRepository } from "../src/db/repositories/user-repository";

async function setup() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
  const conversation = await new ConversationRepository(db, tenant).create({ channel: "widget", agentKey: "support-generalist" });
  const staffUser = await new UserRepository(db, tenant).create({ email: "agent@tenant-a.demo", passwordHash: "hash", role: "agent" });
  return { db, tenant, conversation, staffUser };
}

describe("ReviewQueueRepository", () => {
  it("enqueues a pending item scoped to its conversation", async () => {
    const { db, tenant, conversation } = await setup();
    const queue = new ReviewQueueRepository(db, tenant);

    const item = await queue.enqueue({ conversationId: conversation.id, reason: "low_kb_confidence" });
    expect(item.status).toBe("pending");
    expect(item.reason).toBe("low_kb_confidence");
    expect((await queue.listPending()).map((i) => i.id)).toEqual([item.id]);
  });

  it("marking an item reviewed or dismissed removes it from listPending", async () => {
    const { db, tenant, conversation, staffUser } = await setup();
    const queue = new ReviewQueueRepository(db, tenant);
    const a = await queue.enqueue({ conversationId: conversation.id, reason: "low_kb_confidence" });
    const b = await queue.enqueue({ conversationId: conversation.id, reason: "low_kb_confidence" });

    await queue.markDecided(a.id, "reviewed", staffUser.id);
    await queue.markDecided(b.id, "dismissed", staffUser.id);

    expect(await queue.listPending()).toEqual([]);
    expect((await queue.get(a.id))?.status).toBe("reviewed");
    expect((await queue.get(a.id))?.reviewedBy).toBe(staffUser.id);
    expect((await queue.get(a.id))?.reviewedAt).toBeTruthy();
    expect((await queue.get(b.id))?.status).toBe("dismissed");
  });

  it("is tenant-scoped — one tenant never sees another's queue", async () => {
    const db = createDb(":memory:");
    const tenantA = await new TenantRepository(db).create("A", "a");
    const tenantB = await new TenantRepository(db).create("B", "b");
    const convA = await new ConversationRepository(db, tenantA).create({ channel: "widget", agentKey: "support-generalist" });

    await new ReviewQueueRepository(db, tenantA).enqueue({ conversationId: convA.id, reason: "low_kb_confidence" });

    expect(await new ReviewQueueRepository(db, tenantB).listPending()).toEqual([]);
  });
});
