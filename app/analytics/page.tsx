import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformContext } from "../../src/platform/context";
import { getSessionUser } from "../../src/auth/session";
import { SignOutButton } from "../../components/desk/SignOutButton";
import { AgentDefRepository } from "../../src/db/repositories/agent-def-repository";
import { getAgentVolume, getContainmentRate, getEscalationReasonBreakdown, getLatencyPercentiles, getAgentVersionPerformance } from "../../src/analytics/agent-performance";

export const dynamic = "force-dynamic";

/** Phase 2 M7a: top-level analytics dashboard — table-based, no charting dependency in this repo yet. */
export default async function AnalyticsPage() {
  const { db, tenant } = getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");

  const volume = getAgentVolume(db, tenant);
  const containment = getContainmentRate(db, tenant);
  const escalationReasons = getEscalationReasonBreakdown(db, tenant);
  const latency = getLatencyPercentiles(db, tenant);
  const agentKeys = [...new Set(new AgentDefRepository(db, tenant).listAllPublished().map((a) => a.key))];
  const versionPerformance = agentKeys.map((key) => ({ key, versions: getAgentVersionPerformance(db, tenant, key) })).filter((v) => v.versions.length > 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Analytics</h1>
        <p className="flex items-center gap-2 text-xs text-muted">
          {user.email} · {user.role}
          <SignOutButton />
        </p>
      </div>
      <div className="mt-1 flex gap-3 text-xs">
        <Link href="/analytics/coverage-gaps" className="text-accent hover:underline">
          Coverage gaps →
        </Link>
        <Link href="/desk" className="text-accent hover:underline">
          Human desk →
        </Link>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">Containment</h2>
        <p className="mt-1 text-2xl font-semibold text-fg">{(containment.rate * 100).toFixed(1)}%</p>
        <p className="text-xs text-muted">
          {containment.containedConversations} of {containment.totalConversations} conversations never escalated
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">Model latency</h2>
        <p className="mt-1 text-xs text-muted">
          p50: {latency.p50}ms · p95: {latency.p95}ms · {latency.count} calls
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Volume by agent</h2>
        <table className="mt-2 w-full overflow-x-auto rounded-xl border border-border bg-surface text-sm">
          <tbody>
            {volume.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-muted">No runs yet.</td>
              </tr>
            ) : (
              volume.map((v) => (
                <tr key={v.agentKey} className="border-t border-border first:border-t-0">
                  <td className="px-4 py-2 text-fg">{v.agentKey}</td>
                  <td className="px-4 py-2 text-right text-muted">{v.runCount} run(s)</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Escalation reasons</h2>
        <table className="mt-2 w-full overflow-x-auto rounded-xl border border-border bg-surface text-sm">
          <tbody>
            {escalationReasons.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-muted">No escalations recorded yet.</td>
              </tr>
            ) : (
              escalationReasons.map((r) => (
                <tr key={r.reason} className="border-t border-border first:border-t-0">
                  <td className="px-4 py-2 text-fg">{r.reason}</td>
                  <td className="px-4 py-2 text-right text-muted">{r.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {versionPerformance.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-muted">Per-version performance</h2>
          <div className="mt-2 space-y-4">
            {versionPerformance.map(({ key, versions }) => (
              <div key={key} className="rounded-xl border border-border bg-surface p-3">
                <p className="text-sm font-medium text-fg">{key}</p>
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="pb-1 font-normal">Version</th>
                      <th className="pb-1 font-normal">Runs</th>
                      <th className="pb-1 font-normal">Avg cost</th>
                      <th className="pb-1 font-normal">Avg latency</th>
                      <th className="pb-1 font-normal">Escalation rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.agentVersion} className="border-t border-border">
                        <td className="py-1 text-fg">v{v.agentVersion}</td>
                        <td className="py-1 text-muted">{v.runCount}</td>
                        <td className="py-1 text-muted">${v.avgCostUsd.toFixed(4)}</td>
                        <td className="py-1 text-muted">{Math.round(v.avgLatencyMs)}ms</td>
                        <td className="py-1 text-muted">{(v.escalationRate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
