import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { TicketRepository } from "../src/db/repositories/ticket-repository";

async function setup() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
  const conversation = new ConversationRepository(db, tenant).create({ channel: "email", agentKey: "support-generalist" });
  return { db, tenant, conversation };
}

describe("TicketRepository (FR-3.17/3.18)", () => {
  it("creates a ticket in 'new' status, scoped to its conversation", async () => {
    const { db, tenant, conversation } = await setup();
    const tickets = new TicketRepository(db, tenant);

    const ticket = tickets.create({ conversationId: conversation.id, subject: "Where is my order?" });
    expect(ticket.status).toBe("new");
    expect(ticket.priority).toBe("normal");
    expect(tickets.getByConversation(conversation.id)?.id).toBe(ticket.id);
  });

  it("walks the full lifecycle: new -> open -> pending_customer -> pending_internal -> resolved -> closed", async () => {
    const { db, tenant, conversation } = await setup();
    const tickets = new TicketRepository(db, tenant);
    const ticket = tickets.create({ conversationId: conversation.id, subject: "Return request" });

    for (const status of ["open", "pending_customer", "pending_internal", "resolved", "closed"] as const) {
      tickets.setStatus(ticket.id, status);
      expect(tickets.get(ticket.id)?.status).toBe(status);
    }
  });

  it("rejects a status outside the FR-3.17 lifecycle at the schema level", async () => {
    const { db, tenant, conversation } = await setup();
    const tickets = new TicketRepository(db, tenant);
    const ticket = tickets.create({ conversationId: conversation.id, subject: "Bad status test" });

    expect(() => tickets.setStatus(ticket.id, "not_a_real_status" as never)).toThrow();
  });

  it("assigns and reassigns a ticket to staff users", async () => {
    const { db, tenant, conversation } = await setup();
    const users = new UserRepository(db, tenant);
    const agentUser = await users.create({ email: "agent@tenant-a.demo", passwordHash: "x", role: "agent" });
    const tickets = new TicketRepository(db, tenant);
    const ticket = tickets.create({ conversationId: conversation.id, subject: "Assignment test" });

    tickets.assign(ticket.id, agentUser.id);
    expect(tickets.get(ticket.id)?.assigneeId).toBe(agentUser.id);

    tickets.assign(ticket.id, null);
    expect(tickets.get(ticket.id)?.assigneeId).toBeNull();
  });

  it("filters by status via list()", async () => {
    const { db, tenant, conversation } = await setup();
    const tickets = new TicketRepository(db, tenant);
    const open = tickets.create({ conversationId: conversation.id, subject: "Open one" });
    const conversation2 = new ConversationRepository(db, tenant).create({ channel: "email", agentKey: "support-generalist" });
    const closed = tickets.create({ conversationId: conversation2.id, subject: "Closed one" });
    tickets.setStatus(closed.id, "closed");

    const openOnly = tickets.list({ statuses: ["new"] });
    expect(openOnly.map((t) => t.id)).toEqual([open.id]);

    expect(tickets.list().map((t) => t.id).sort()).toEqual([closed.id, open.id].sort());
  });
});
