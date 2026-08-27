import { randomUUID } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { Conversation, ConversationChannel, ConversationPriority, ConversationState } from "../../core/types";

interface ConversationRow {
  id: string;
  tenant_id: string;
  channel: ConversationChannel;
  state: ConversationState;
  current_agent_key: string | null;
  priority: ConversationPriority;
  tags: string;
  sla_due_at: string | null;
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
    priority: row.priority,
    tags: fromJson<string[]>(row.tags),
    slaDueAt: row.sla_due_at,
    metadata: fromJson<Record<string, unknown>>(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async create(input: { id?: string; channel: ConversationChannel; agentKey: string; metadata?: Record<string, unknown> }): Promise<Conversation> {
    const id = input.id ?? `CONV-${randomUUID()}`;
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO conversations (id, tenant_id, channel, state, current_agent_key, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 'bot_active', ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.channel, input.agentKey, JSON.stringify(input.metadata ?? {}), now, now);
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Conversation | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM conversations WHERE tenant_id = ? AND id = ?`)
      .get(this.tenantId, id) as ConversationRow | undefined;
    return row ? rowToConversation(row) : undefined;
  }

  async setState(id: string, state: ConversationState): Promise<void> {
    await this.db
      .prepare(`UPDATE conversations SET state = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(state, new Date().toISOString(), this.tenantId, id);
  }

  /** Shallow-merges `patch` into the existing metadata JSON (e.g. the handoff mechanism's agentPath). */
  async updateMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const merged = { ...current.metadata, ...patch };
    await this.db.prepare(`UPDATE conversations SET metadata = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(JSON.stringify(merged), new Date().toISOString(), this.tenantId, id);
  }

  async setCurrentAgentKey(id: string, agentKey: string): Promise<void> {
    await this.db.prepare(`UPDATE conversations SET current_agent_key = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(agentKey, new Date().toISOString(), this.tenantId, id);
  }

  /** Phase 2 M6b: cheapest "skill area" signal — set to [currentAgentKey] whenever the handling agent changes. Fully replaces the array — see addTags below for the merge variant Phase 9's auto-tagging needs instead. */
  async setTags(id: string, tags: string[]): Promise<void> {
    await this.db.prepare(`UPDATE conversations SET tags = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(JSON.stringify(tags), new Date().toISOString(), this.tenantId, id);
  }

  /** Phase 9 M4: union newTags into whatever's already there, instead of replacing — auto-tagging must coexist with setTags' agent-key bookkeeping (src/channel/turn.ts) regardless of which one ran most recently in a turn. */
  async addTags(id: string, newTags: string[]): Promise<void> {
    if (newTags.length === 0) return;
    const current = await this.get(id);
    if (!current) return;
    const merged = [...new Set([...current.tags, ...newTags])];
    await this.db.prepare(`UPDATE conversations SET tags = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(JSON.stringify(merged), new Date().toISOString(), this.tenantId, id);
  }

  /** Phase 2 M4: null clears the SLA clock (e.g. a conversation leaving awaiting_human). */
  async setSlaDueAt(id: string, dueAt: string | null): Promise<void> {
    await this.db.prepare(`UPDATE conversations SET sla_due_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(dueAt, new Date().toISOString(), this.tenantId, id);
  }

  /** Phase 2 M4: read-time breach check — no scheduler exists in this deployment, so "breaching" is computed on each desk page load, not pushed. */
  async listSlaBreaching(nowTimestamp: string): Promise<Conversation[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM conversations WHERE tenant_id = ? AND state = 'awaiting_human' AND sla_due_at IS NOT NULL AND sla_due_at < ? ORDER BY sla_due_at ASC`)
      .all(this.tenantId, nowTimestamp) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  async listByStates(states: ConversationState[]): Promise<Conversation[]> {
    const placeholders = states.map(() => "?").join(",");
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversations WHERE tenant_id = ? AND state IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .all(this.tenantId, ...states) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /** FR-3.12 subject-hash fallback: used when an inbound email carries no In-Reply-To/References match. */
  async findBySubjectHash(subjectHash: string): Promise<Conversation | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM conversations WHERE tenant_id = ? AND channel = 'email' AND metadata->>'subjectHash' = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(this.tenantId, subjectHash) as ConversationRow | undefined;
    return row ? rowToConversation(row) : undefined;
  }
}
