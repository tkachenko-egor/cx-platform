import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { CanonicalMessage, MessageRole, MessageVisibility } from "../../core/types";

interface MessageRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  visibility: MessageVisibility;
  sequence: number;
  created_at: string;
}

function rowToMessage(row: MessageRow): CanonicalMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    role: row.role,
    content: row.content,
    contentType: "text",
    authorType: row.role === "user" ? "customer" : row.role === "agent_human" ? "human" : "bot",
    authorId: null,
    visibility: row.visibility,
    sequence: row.sequence,
    createdAt: row.created_at,
  };
}

/** FR-4.3: append-only — messages are never edited in place. */
export class MessageRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  append(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    visibility?: MessageVisibility;
  }): CanonicalMessage {
    const id = randomUUID();
    const now = new Date().toISOString();
    const sequence = this.nextSequence(input.conversationId);
    this.db
      .prepare(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, visibility, sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.conversationId, input.role, input.content, input.visibility ?? "public", sequence, now);
    return rowToMessage({
      id,
      tenant_id: this.tenantId,
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      visibility: input.visibility ?? "public",
      sequence,
      created_at: now,
    });
  }

  listByConversation(conversationId: string, opts: { includeInternal?: boolean } = {}): CanonicalMessage[] {
    const visibilityClause = opts.includeInternal ? "" : `AND visibility = 'public'`;
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE tenant_id = ? AND conversation_id = ? ${visibilityClause} ORDER BY sequence ASC`,
      )
      .all(this.tenantId, conversationId) as MessageRow[];
    return rows.map(rowToMessage);
  }

  private nextSequence(conversationId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(sequence) as maxSeq FROM messages WHERE tenant_id = ? AND conversation_id = ?`)
      .get(this.tenantId, conversationId) as { maxSeq: number | null };
    return (row.maxSeq ?? 0) + 1;
  }
}
