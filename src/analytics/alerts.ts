import type { Tenant } from "../db/repositories/tenant-repository";
import type { SqlDatabase } from "../db/pg";
import { MessageFeedbackRepository } from "../db/repositories/message-feedback-repository";
import { getContainmentRate } from "./agent-performance";

export interface ActiveAlert {
  label: string;
  detail: string;
}

/**
 * Phase 9 M4: in-app, pull-based only — there's no email/webhook delivery
 * infrastructure anywhere in this codebase to build on, and standing one up
 * is a bigger decision than this checklist subtask. Compares the existing
 * containment-rate query (handoff rate = 1 - containment) and a CSAT
 * average against tenants.alert_thresholds, both already-computed metrics —
 * no new aggregation machinery, just a threshold comparison.
 */
export async function getActiveAlerts(db: SqlDatabase, tenant: Tenant): Promise<ActiveAlert[]> {
  const alerts: ActiveAlert[] = [];
  const { maxHandoffRatePct, minCsatScore } = tenant.alertThresholds;

  if (maxHandoffRatePct != null) {
    const containment = await getContainmentRate(db, tenant);
    if (containment.totalConversations > 0) {
      const handoffRatePct = (1 - containment.rate) * 100;
      if (handoffRatePct > maxHandoffRatePct) {
        alerts.push({ label: "Handoff rate above threshold", detail: `${handoffRatePct.toFixed(1)}% of conversations handed off (threshold: ${maxHandoffRatePct}%)` });
      }
    }
  }

  if (minCsatScore != null) {
    const feedback = await new MessageFeedbackRepository(db, tenant).aggregateForTenant();
    if (feedback.total > 0) {
      const csatPct = (feedback.up / feedback.total) * 100;
      if (csatPct < minCsatScore) {
        alerts.push({ label: "CSAT below threshold", detail: `${csatPct.toFixed(1)}% positive feedback (threshold: ${minCsatScore}%)` });
      }
    }
  }

  return alerts;
}
