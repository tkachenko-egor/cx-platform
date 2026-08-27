import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export type FeedbackRating = "up" | "down";

export interface MessageFeedback {
  id: string;
  tenantId: string;
  conversationId: string;
  messageId: string;
  rating: FeedbackRating;
  comment: string | null;
  createdAt: string;
}

interface MessageFeedbackRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  message_id: string;
  rating: FeedbackRating;
  comment: string | null;
  created_at: string;
}

function rowToFeedback(row: MessageFeedbackRow): MessageFeedback {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

/** Phase 9 M4: thumbs up/down per bot message — see app/api/chat/feedback/route.ts and app/api/embed-chat/[publicKey]/feedback/route.ts. */
export class MessageFeedbackRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  /** One rating per message — re-submitting (a customer changing their mind) overwrites rather than erroring on the UNIQUE(tenant_id, message_id) constraint. */
  async record(input: { conversationId: string; messageId: string; rating: FeedbackRating; comment?: string | null }): Promise<MessageFeedback> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO message_feedback (id, tenant_id, conversation_id, message_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, message_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = excluded.created_at`,
      )
      .run(id, this.tenantId, input.conversationId, input.messageId, input.rating, input.comment ?? null, now);
    const row = await this.db.prepare(`SELECT * FROM message_feedback WHERE tenant_id = ? AND message_id = ?`).get(this.tenantId, input.messageId) as MessageFeedbackRow;
    return rowToFeedback(row);
  }

  /** Phase 9 M4: the CSAT stat tile on /analytics — % thumbs-up of all feedback, tenant-wide. No test_harness exclusion needed here (unlike src/analytics/agent-performance.ts's queries): the admin preview chat never renders feedback controls, so a preview conversation can never have a row here. */
  async aggregateForTenant(): Promise<{ total: number; up: number }> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN rating = 'up' THEN 1 ELSE 0 END) as up FROM message_feedback WHERE tenant_id = ?`)
      .get(this.tenantId) as { total: number; up: number | null };
    return { total: row.total, up: row.up ?? 0 };
  }
}
