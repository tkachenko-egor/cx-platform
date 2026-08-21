import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, DollarSign, Timer, MessageSquare } from "lucide-react";
import { getPlatformContext } from "../../../../../src/platform/context";
import { AgentDefRepository } from "../../../../../src/db/repositories/agent-def-repository";
import { getAgentVolume, getContainmentRate, getEscalationReasonBreakdown, getLatencyPercentiles, getAgentVersionPerformance } from "../../../../../src/analytics/agent-performance";
import { Card } from "../../../../../components/ui/Card";
import { StatTile } from "../../../../../components/ui/StatTile";
import { BarList } from "../../../../../components/ui/BarList";

export const dynamic = "force-dynamic";

/** Phase 5 M6: before this, agent-performance data only existed on the tenant-wide /analytics page (version-performance and latency were already agent-scoped there; volume/containment/escalation-reasons gained an optional agentKey filter to support this page). */
export default async function AgentAnalyticsPage(props: PageProps<"/admin/agents/[key]/analytics">) {
  const { key } = await props.params;
  const { db, tenant } = await getPlatformContext();

  const agentDef = new AgentDefRepository(db, tenant).getLatestPublished(key);
  if (!agentDef) notFound();

  const volume = getAgentVolume(db, tenant, { agentKey: key });
  const runCount = volume.reduce((sum, v) => sum + v.runCount, 0);
  const containment = getContainmentRate(db, tenant, { agentKey: key });
  const latency = getLatencyPercentiles(db, tenant, { agentKey: key });
  const escalationReasons = getEscalationReasonBreakdown(db, tenant, { agentKey: key });
  const versions = getAgentVersionPerformance(db, tenant, key);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href={`/admin/agents/${key}`} className="flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft size={13} /> {key}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-fg">{key} — analytics</h1>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={MessageSquare} label="Runs" value={String(runCount)} />
        <StatTile icon={TrendingUp} label="Containment" value={containment.totalConversations > 0 ? `${Math.round(containment.rate * 100)}%` : "—"} hint={`${containment.containedConversations} of ${containment.totalConversations}`} />
        <StatTile icon={Timer} label="Latency (p50 / p95)" value={latency.count > 0 ? `${latency.p50}ms / ${latency.p95}ms` : "—"} hint={`${latency.count} calls`} />
        <StatTile icon={DollarSign} label="Avg cost / run" value={versions.length > 0 ? `$${(versions.reduce((s, v) => s + v.avgCostUsd * v.runCount, 0) / Math.max(1, runCount)).toFixed(4)}` : "—"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-fg">Escalation reasons</h2>
          <div className="mt-4">
            <BarList rows={escalationReasons.map((r) => ({ label: r.reason, value: r.count }))} />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-fg">Per-version performance</h2>
          <div className="mt-4 overflow-x-auto">
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
                {versions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-muted">
                      No runs yet.
                    </td>
                  </tr>
                )}
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
        </Card>
      </div>
    </main>
  );
}
