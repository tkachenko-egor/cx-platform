import { randomUUID } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { ConversationEvent, ConversationEventType } from "../../core/types";

interface EventRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  type: ConversationEventType;
  payload: string;
  actor: string;
  created_at: string;
}

function rowToEvent(row: EventRow): ConversationEvent {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    type: row.type,
    payload: fromJson<Record<string, unknown>>(row.payload),
    actor: row.actor,
    createdAt: row.created_at,
  };
}

/** FR-4.2/4.3: append-only log — how "what state was this conversation in at 14:32" gets answered. */
export class EventRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async append(input: { conversationId: string; type: ConversationEventType; payload?: Record<string, unknown>; actor: string }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO events (id, tenant_id, conversation_id, type, payload, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), this.tenantId, input.conversationId, input.type, JSON.stringify(input.payload ?? {}), input.actor, new Date().toISOString());
  }

  async listByConversation(conversationId: string): Promise<ConversationEvent[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM events WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at ASC`)
      .all(this.tenantId, conversationId) as EventRow[];
    return rows.map(rowToEvent);
  }
}
