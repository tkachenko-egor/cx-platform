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

interface MessageThreadRow {
  conversation_id: string;
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
    /** Channel-threading columns (FR-3.12) — only email uses these today. */
    channelMessageId?: string;
    inReplyTo?: string;
  }): CanonicalMessage {
    const id = randomUUID();
    const now = new Date().toISOString();
    const sequence = this.nextSequence(input.conversationId);
    this.db
      .prepare(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, visibility, sequence, channel_message_id, in_reply_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.conversationId,
        input.role,
        input.content,
        input.visibility ?? "public",
        sequence,
        input.channelMessageId ?? null,
        input.inReplyTo ?? null,
        now,
      );
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

  /** Sets the outbound channel id after the fact — e.g. the email provider's Message-ID, known only once the send succeeds. */
  setChannelMessageId(id: string, channelMessageId: string): void {
    this.db.prepare(`UPDATE messages SET channel_message_id = ? WHERE tenant_id = ? AND id = ?`).run(channelMessageId, this.tenantId, id);
  }

  /** FR-3.12: resolve a conversation from Message-ID/In-Reply-To/References headers. */
  findConversationIdByChannelMessageIds(channelMessageIds: string[]): string | undefined {
    if (channelMessageIds.length === 0) return undefined;
    const placeholders = channelMessageIds.map(() => "?").join(",");
    const row = this.db
      .prepare(`SELECT conversation_id FROM messages WHERE tenant_id = ? AND channel_message_id IN (${placeholders}) ORDER BY sequence DESC LIMIT 1`)
      .get(this.tenantId, ...channelMessageIds) as MessageThreadRow | undefined;
    return row?.conversation_id;
  }

  /** Phase 9 M4: lets a feedback-submission route confirm the message actually belongs to the conversation/tenant it claims before recording anything. */
  get(id: string): CanonicalMessage | undefined {
    const row = this.db.prepare(`SELECT * FROM messages WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as MessageRow | undefined;
    return row ? rowToMessage(row) : undefined;
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

  /** DA-01: last public message per conversation, for the desk list's message preview — not paginated/indexed for scale, the desk queue is expected to be tens of conversations, not thousands. */
  latestByConversationIds(conversationIds: string[]): Map<string, CanonicalMessage> {
    if (conversationIds.length === 0) return new Map();
    const placeholders = conversationIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE tenant_id = ? AND conversation_id IN (${placeholders}) AND visibility = 'public' ORDER BY sequence ASC`)
      .all(this.tenantId, ...conversationIds) as MessageRow[];
    const latest = new Map<string, CanonicalMessage>();
    for (const row of rows) latest.set(row.conversation_id, rowToMessage(row));
    return latest;
  }

  private nextSequence(conversationId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(sequence) as maxSeq FROM messages WHERE tenant_id = ? AND conversation_id = ?`)
      .get(this.tenantId, conversationId) as { maxSeq: number | null };
    return (row.maxSeq ?? 0) + 1;
  }
}
