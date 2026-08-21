import type Database from "better-sqlite3";
import type { TenantContext } from "../tenancy/context";

export interface AgentVolumeRow {
  agentKey: string;
  runCount: number;
}

/** Volume per agent — a straight COUNT over `runs`, the join point every debugging/cost question already uses. */
export function getAgentVolume(db: Database.Database, tenant: TenantContext, options: { since?: string } = {}): AgentVolumeRow[] {
  const query = options.since
    ? `SELECT agent_key as agentKey, COUNT(*) as runCount FROM runs WHERE tenant_id = ? AND started_at >= ? GROUP BY agent_key ORDER BY runCount DESC`
    : `SELECT agent_key as agentKey, COUNT(*) as runCount FROM runs WHERE tenant_id = ? GROUP BY agent_key ORDER BY runCount DESC`;
  const params = options.since ? [tenant.tenantId, options.since] : [tenant.tenantId];
  return db.prepare(query).all(...params) as AgentVolumeRow[];
}

export interface EscalationReasonCount {
  reason: string;
  count: number;
}

/**
 * Escalation-reason breakdown — `events.payload.reasons` is a JSON array
 * per escalated event, previously only ever read ad hoc per conversation
 * on the desk detail page, never aggregated. Small enough at this scale to
 * tally in JS rather than reaching for SQLite's json_each.
 */
export function getEscalationReasonBreakdown(db: Database.Database, tenant: TenantContext, options: { since?: string } = {}): EscalationReasonCount[] {
  const query = options.since
    ? `SELECT payload FROM events WHERE tenant_id = ? AND type = 'escalated' AND created_at >= ?`
    : `SELECT payload FROM events WHERE tenant_id = ? AND type = 'escalated'`;
  const params = options.since ? [tenant.tenantId, options.since] : [tenant.tenantId];
  const rows = db.prepare(query).all(...params) as { payload: string }[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as { reasons?: unknown };
    const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
    for (const reason of reasons) {
      if (typeof reason === "string") counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

export interface ContainmentRate {
  totalConversations: number;
  containedConversations: number;
  rate: number;
}

/**
 * "Contained" = never logged an `escalated` event — the doc's own §11
 * containment metric, adapted to what this data model actually tracks.
 * `conversations.state` never reaches 'resolved'/'closed' anywhere in the
 * codebase (no ticket-closing flow exists yet), so containment can't be
 * "resolved without escalation" as originally sketched; "never escalated
 * at all" is the honest substitute, and M1's event-integrity fix is what
 * makes it reliable.
 */
export function getContainmentRate(db: Database.Database, tenant: TenantContext, options: { since?: string } = {}): ContainmentRate {
  const query = options.since ? `SELECT id FROM conversations WHERE tenant_id = ? AND created_at >= ?` : `SELECT id FROM conversations WHERE tenant_id = ?`;
  const params = options.since ? [tenant.tenantId, options.since] : [tenant.tenantId];
  const conversationIds = (db.prepare(query).all(...params) as { id: string }[]).map((r) => r.id);
  if (conversationIds.length === 0) return { totalConversations: 0, containedConversations: 0, rate: 0 };

  const placeholders = conversationIds.map(() => "?").join(",");
  const escalatedCount = (
    db.prepare(`SELECT COUNT(DISTINCT conversation_id) as c FROM events WHERE tenant_id = ? AND type = 'escalated' AND conversation_id IN (${placeholders})`).get(tenant.tenantId, ...conversationIds) as {
      c: number;
    }
  ).c;

  const total = conversationIds.length;
  const contained = total - escalatedCount;
  return { totalConversations: total, containedConversations: contained, rate: contained / total };
}

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  count: number;
}

/** No PERCENTILE_CONT in SQLite — small enough at this scale to sort in JS rather than reach for a window-function approximation. */
export function getLatencyPercentiles(db: Database.Database, tenant: TenantContext, options: { agentKey?: string; since?: string } = {}): LatencyPercentiles {
  const conditions = ["lc.tenant_id = ?"];
  const params: unknown[] = [tenant.tenantId];
  let query = `SELECT lc.latency_ms as latencyMs FROM llm_calls lc`;

  if (options.agentKey) {
    query += ` JOIN runs r ON r.id = lc.run_id AND r.tenant_id = lc.tenant_id`;
    conditions.push("r.agent_key = ?");
    params.push(options.agentKey);
  }
  if (options.since) {
    conditions.push("lc.created_at >= ?");
    params.push(options.since);
  }
  query += ` WHERE ${conditions.join(" AND ")}`;

  const sorted = (db.prepare(query).all(...params) as { latencyMs: number }[]).map((r) => r.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
  return { p50: percentile(0.5), p95: percentile(0.95), count: sorted.length };
}

export interface AgentVersionPerformance {
  agentVersion: number;
  runCount: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  escalationRate: number;
}

/** Phase 2 M7a: the read side of M6a's A/B tests — per-version cost/latency/escalation-rate comparison. */
export function getAgentVersionPerformance(db: Database.Database, tenant: TenantContext, agentKey: string, options: { since?: string } = {}): AgentVersionPerformance[] {
  const sinceClause = options.since ? "AND started_at >= ?" : "";
  const listParams = options.since ? [tenant.tenantId, agentKey, options.since] : [tenant.tenantId, agentKey];
  const versions = (db.prepare(`SELECT DISTINCT agent_version FROM runs WHERE tenant_id = ? AND agent_key = ? ${sinceClause}`).all(...listParams) as { agent_version: number }[]).map(
    (r) => r.agent_version,
  );

  return versions
    .map((agentVersion) => {
      const runRows = db
        .prepare(`SELECT id, conversation_id FROM runs WHERE tenant_id = ? AND agent_key = ? AND agent_version = ? ${sinceClause}`)
        .all(...(options.since ? [tenant.tenantId, agentKey, agentVersion, options.since] : [tenant.tenantId, agentKey, agentVersion])) as { id: string; conversation_id: string }[];
      const runIds = runRows.map((r) => r.id);
      const conversationIds = [...new Set(runRows.map((r) => r.conversation_id))];

      let avgCostUsd = 0;
      let avgLatencyMs = 0;
      if (runIds.length > 0) {
        const placeholders = runIds.map(() => "?").join(",");
        const agg = db.prepare(`SELECT AVG(cost_usd) as avgCost, AVG(latency_ms) as avgLatency FROM llm_calls WHERE tenant_id = ? AND run_id IN (${placeholders})`).get(tenant.tenantId, ...runIds) as {
          avgCost: number | null;
          avgLatency: number | null;
        };
        avgCostUsd = agg.avgCost ?? 0;
        avgLatencyMs = agg.avgLatency ?? 0;
      }

      let escalationRate = 0;
      if (conversationIds.length > 0) {
        const placeholders = conversationIds.map(() => "?").join(",");
        const escalatedCount = (
          db.prepare(`SELECT COUNT(DISTINCT conversation_id) as c FROM events WHERE tenant_id = ? AND type = 'escalated' AND conversation_id IN (${placeholders})`).get(
            tenant.tenantId,
            ...conversationIds,
          ) as { c: number }
        ).c;
        escalationRate = escalatedCount / conversationIds.length;
      }

      return { agentVersion, runCount: runRows.length, avgCostUsd, avgLatencyMs, escalationRate };
    })
    .sort((a, b) => a.agentVersion - b.agentVersion);
}
