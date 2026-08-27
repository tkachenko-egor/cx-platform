import { redirect } from "next/navigation";
import { TrendingUp, Timer, MessageSquare, AlertTriangle, DollarSign, Smile } from "lucide-react";
import { getPlatformContext } from "../../src/platform/context";
import { getSessionUser } from "../../src/auth/session";
import { loginRedirectPath } from "../../src/auth/login-redirect";
import { roleAtLeast } from "../../src/auth/permissions";
import { AgentDefRepository } from "../../src/db/repositories/agent-def-repository";
import { MessageFeedbackRepository } from "../../src/db/repositories/message-feedback-repository";
import { getAgentVolume, getContainmentRate, getEscalationReasonBreakdown, getLatencyPercentiles, getAgentVersionPerformance } from "../../src/analytics/agent-performance";
import { getActiveAlerts } from "../../src/analytics/alerts";
import { Card } from "../../components/ui/Card";
import { StatTile } from "../../components/ui/StatTile";
import { BarList } from "../../components/ui/BarList";
import { Tabs } from "../../components/ui/Tabs";
import { AgentPicker } from "../../components/admin/AgentPicker";
import { AlertThresholdsCard } from "../../components/admin/AlertThresholdsCard";

export const dynamic = "force-dynamic";

/** Phase 2 M7a, chrome fixed up later: table-based, no charting dependency in this repo yet. Phase 6 M8: optional ?agent= scopes every number on this page to one agent instead of the tenant. */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect(await loginRedirectPath());

  const { agent: agentKey } = await searchParams;
  const options = agentKey ? { agentKey } : {};

  const volume = await getAgentVolume(db, tenant, options);
  const containment = await getContainmentRate(db, tenant, options);
  const escalationReasons = await getEscalationReasonBreakdown(db, tenant, options);
  const latency = await getLatencyPercentiles(db, tenant, options);
  const agentKeys = [...new Set((await new AgentDefRepository(db, tenant).listAllPublished()).map((a) => a.key))];
  const versionPerformance = (
    await Promise.all(
      (agentKey ? [agentKey] : agentKeys).map(async (key) => ({ key, versions: await getAgentVersionPerformance(db, tenant, key) })),
    )
  ).filter((v) => v.versions.length > 0);
  const totalRuns = versionPerformance.reduce((sum, { versions }) => sum + versions.reduce((s, v) => s + v.runCount, 0), 0);
  const totalCost = versionPerformance.reduce((sum, { versions }) => sum + versions.reduce((s, v) => s + v.avgCostUsd * v.runCount, 0), 0);
  const avgCostPerRun = totalRuns > 0 ? totalCost / totalRuns : null;

  const feedback = await new MessageFeedbackRepository(db, tenant).aggregateForTenant();
  const csatPct = feedback.total > 0 ? (feedback.up / feedback.total) * 100 : null;
  const activeAlerts = await getActiveAlerts(db, tenant);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Analytics</h1>
          <p className="mt-1 text-sm text-muted">{agentKey ? `Performance for ${agentKey}.` : "Company-wide performance across every agent."}</p>
        </div>
        <AgentPicker agentKeys={agentKeys} selected={agentKey} />
      </div>

      <div className="mt-4">
        <Tabs active={agentKey ? `/analytics?agent=${agentKey}` : "/analytics"} items={[{ href: agentKey ? `/analytics?agent=${agentKey}` : "/analytics", label: "Overview" }, { href: "/analytics/coverage-gaps", label: "Coverage gaps" }]} />
      </div>

      <AlertThresholdsCard
        activeAlerts={activeAlerts}
        maxHandoffRatePct={tenant.alertThresholds.maxHandoffRatePct ?? null}
        minCsatScore={tenant.alertThresholds.minCsatScore ?? null}
        canEdit={roleAtLeast(user.role, "admin")}
      />

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile
          icon={TrendingUp}
          label="Containment"
          value={containment.totalConversations > 0 ? `${Math.round(containment.rate * 100)}%` : "—"}
          hint={`${containment.containedConversations} of ${containment.totalConversations} conversations`}
        />
        <StatTile icon={Timer} label="Model latency (p50 / p95)" value={latency.count > 0 ? `${latency.p50}ms / ${latency.p95}ms` : "—"} hint={`${latency.count} calls`} />
        <StatTile icon={MessageSquare} label="Total runs" value={String(volume.reduce((sum, v) => sum + v.runCount, 0))} />
        <StatTile icon={DollarSign} label="Avg cost / run" value={avgCostPerRun !== null ? `$${avgCostPerRun.toFixed(4)}` : "—"} />
        <StatTile icon={Smile} label="CSAT" value={csatPct !== null ? `${Math.round(csatPct)}%` : "—"} hint={feedback.total > 0 ? `${feedback.total} ratings` : "No feedback yet"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-fg">Volume by agent</h2>
          <div className="mt-4">
            <BarList rows={volume.map((v) => ({ label: v.agentKey, value: v.runCount }))} />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-muted" />
            <h2 className="text-sm font-semibold text-fg">Escalation reasons</h2>
          </div>
          <div className="mt-4">
            <BarList rows={escalationReasons.map((r) => ({ label: r.reason, value: r.count }))} />
          </div>
        </Card>
      </div>

      {versionPerformance.length > 0 && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-semibold text-fg">Per-version performance</h2>
          <div className="mt-4 space-y-4">
            {versionPerformance.map(({ key, versions }) => (
              <div key={key}>
                <p className="text-sm font-medium text-fg">{key}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted">
                        <th className="py-1.5 pr-3 font-medium">Version</th>
                        <th className="py-1.5 pr-3 font-medium">Runs</th>
                        <th className="py-1.5 pr-3 font-medium">Avg cost</th>
                        <th className="py-1.5 pr-3 font-medium">Avg latency</th>
                        <th className="py-1.5 font-medium">Escalation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {versions.map((v) => (
                        <tr key={v.agentVersion}>
                          <td className="py-1.5 pr-3 text-fg">v{v.agentVersion}</td>
                          <td className="py-1.5 pr-3 text-fg">{v.runCount}</td>
                          <td className="py-1.5 pr-3 text-fg">${v.avgCostUsd.toFixed(4)}</td>
                          <td className="py-1.5 pr-3 text-fg">{Math.round(v.avgLatencyMs)}ms</td>
                          <td className="py-1.5 text-fg">{Math.round(v.escalationRate * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </main>
  );
}
