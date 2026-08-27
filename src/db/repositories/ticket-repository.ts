import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export type TicketStatus = "new" | "open" | "pending_customer" | "pending_internal" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface Ticket {
  id: string;
  tenantId: string;
  conversationId: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TicketRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  assignee_id: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assigneeId: row.assignee_id,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** FR-3.17/3.18: ticket lifecycle for the email channel — a separate state machine from Conversation.state. */
export class TicketRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: { conversationId: string; subject: string; priority?: TicketPriority; category?: string }): Promise<Ticket> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tickets (id, tenant_id, conversation_id, subject, status, priority, category, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.conversationId, input.subject, input.priority ?? "normal", input.category ?? null, now, now);
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Ticket | undefined> {
    const row = this.db.prepare(`SELECT * FROM tickets WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as TicketRow | undefined;
    return row ? rowToTicket(row) : undefined;
  }

  async getByConversation(conversationId: string): Promise<Ticket | undefined> {
    const row = this.db.prepare(`SELECT * FROM tickets WHERE tenant_id = ? AND conversation_id = ?`).get(this.tenantId, conversationId) as TicketRow | undefined;
    return row ? rowToTicket(row) : undefined;
  }

  async setStatus(id: string, status: TicketStatus): Promise<void> {
    this.db.prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(status, new Date().toISOString(), this.tenantId, id);
  }

  async assign(id: string, assigneeId: string | null): Promise<void> {
    this.db.prepare(`UPDATE tickets SET assignee_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(assigneeId, new Date().toISOString(), this.tenantId, id);
  }

  async list(opts: { statuses?: TicketStatus[] } = {}): Promise<Ticket[]> {
    if (opts.statuses && opts.statuses.length > 0) {
      const placeholders = opts.statuses.map(() => "?").join(",");
      const rows = this.db
        .prepare(`SELECT * FROM tickets WHERE tenant_id = ? AND status IN (${placeholders}) ORDER BY updated_at DESC`)
        .all(this.tenantId, ...opts.statuses) as TicketRow[];
      return rows.map(rowToTicket);
    }
    const rows = this.db.prepare(`SELECT * FROM tickets WHERE tenant_id = ? ORDER BY updated_at DESC`).all(this.tenantId) as TicketRow[];
    return rows.map(rowToTicket);
  }
}
