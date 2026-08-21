import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { Conversation, ConversationChannel, ConversationState } from "../../core/types";

interface ConversationRow {
  id: string;
  tenant_id: string;
  channel: ConversationChannel;
  state: ConversationState;
  current_agent_key: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: null,
    channel: row.channel,
    state: row.state,
    currentAgentId: row.current_agent_key,
    assigneeId: null,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  create(input: { id?: string; channel: ConversationChannel; agentKey: string; metadata?: Record<string, unknown> }): Conversation {
    const id = input.id ?? `CONV-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO conversations (id, tenant_id, channel, state, current_agent_key, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 'bot_active', ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.channel, input.agentKey, JSON.stringify(input.metadata ?? {}), now, now);
    return this.get(id)!;
  }

  get(id: string): Conversation | undefined {
    const row = this.db
      .prepare(`SELECT * FROM conversations WHERE tenant_id = ? AND id = ?`)
      .get(this.tenantId, id) as ConversationRow | undefined;
    return row ? rowToConversation(row) : undefined;
  }

  setState(id: string, state: ConversationState): void {
    this.db
      .prepare(`UPDATE conversations SET state = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(state, new Date().toISOString(), this.tenantId, id);
  }

  listByStates(states: ConversationState[]): Conversation[] {
    const placeholders = states.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations WHERE tenant_id = ? AND state IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .all(this.tenantId, ...states) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /** FR-3.12 subject-hash fallback: used when an inbound email carries no In-Reply-To/References match. */
  findBySubjectHash(subjectHash: string): Conversation | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM conversations WHERE tenant_id = ? AND channel = 'email' AND json_extract(metadata, '$.subjectHash') = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(this.tenantId, subjectHash) as ConversationRow | undefined;
    return row ? rowToConversation(row) : undefined;
  }
}
