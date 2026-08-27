import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export type ReviewQueueStatus = "pending" | "reviewed" | "dismissed";

export interface ReviewQueueEntry {
  id: string;
  tenantId: string;
  conversationId: string;
  reason: string;
  sourceEventId: string | null;
  status: ReviewQueueStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface ReviewQueueRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  reason: string;
  source_event_id: string | null;
  status: ReviewQueueStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

function rowToEntry(row: ReviewQueueRow): ReviewQueueEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    reason: row.reason,
    sourceEventId: row.source_event_id,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

/**
 * Phase 2 M5: a review tier distinct from escalation — a conversation can
 * stay bot_active and still land here (e.g. a low-confidence KB retrieval
 * the model answered anyway). Mirrors ToolApprovalRepository's
 * pending/decided shape (src/db/repositories/tool-approval-repository.ts).
 */
export class ReviewQueueRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async enqueue(input: { conversationId: string; reason: string; sourceEventId?: string }): Promise<ReviewQueueEntry> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(`INSERT INTO review_queue (id, tenant_id, conversation_id, reason, source_event_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, this.tenantId, input.conversationId, input.reason, input.sourceEventId ?? null, now);
    return { id, tenantId: this.tenantId, conversationId: input.conversationId, reason: input.reason, sourceEventId: input.sourceEventId ?? null, status: "pending", reviewedBy: null, reviewedAt: null, createdAt: now };
  }

  async get(id: string): Promise<ReviewQueueEntry | undefined> {
    const row = await this.db.prepare(`SELECT * FROM review_queue WHERE tenant_id = ? AND id = ?`).get(this.tenantId, id) as ReviewQueueRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  async listPending(): Promise<ReviewQueueEntry[]> {
    const rows = await this.db.prepare(`SELECT * FROM review_queue WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC`).all(this.tenantId) as ReviewQueueRow[];
    return rows.map(rowToEntry);
  }

  async markDecided(id: string, status: "reviewed" | "dismissed", reviewedBy: string): Promise<void> {
    await this.db.prepare(`UPDATE review_queue SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE tenant_id = ? AND id = ?`).run(status, reviewedBy, new Date().toISOString(), this.tenantId, id);
  }
}
