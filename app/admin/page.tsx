import Link from "next/link";
import { Bot, Wrench, Users, TrendingUp, MessageSquare, BookOpen } from "lucide-react";
import { getPlatformContext } from "../../src/platform/context";
import { AgentDefRepository } from "../../src/db/repositories/agent-def-repository";
import { ToolDefRepository } from "../../src/db/repositories/tool-repository";
import { KbCollectionRepository } from "../../src/db/repositories/kb-collection-repository";
import { getContainmentRate, getAgentVolume } from "../../src/analytics/agent-performance";
import { Card } from "../../components/ui/Card";
import { StatTile } from "../../components/ui/StatTile";
import { BarList } from "../../components/ui/BarList";

export const dynamic = "force-dynamic";

/** Phase 5 M5: /admin previously 404'd — no index page existed at all. */
export default async function AdminDashboardPage() {
  const { db, tenant } = await getPlatformContext();

  const agentDefs = await new AgentDefRepository(db, tenant).listAllPublished();
  const latestByKey = new Map<string, (typeof agentDefs)[number]>();
  for (const def of agentDefs) {
    const current = latestByKey.get(def.key);
    if (!current || def.version > current.version) latestByKey.set(def.key, def);
  }
  const agents = [...latestByKey.values()].sort((a, b) => a.key.localeCompare(b.key));

  const tools = await new ToolDefRepository(db, tenant).list();
  const noCodeCount = tools.filter((t) => t.type === "http").length;
  const customCount = tools.filter((t) => t.type === "code").length;

  const collectionsCount = (await new KbCollectionRepository(db, tenant).list()).length;

  const containment = getContainmentRate(db, tenant);
  const volume = getAgentVolume(db, tenant);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">A quick look at what&apos;s built and how it&apos;s performing.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={Users} label="Agents" value={String(agents.length)} />
        <StatTile icon={Wrench} label="Tools" value={String(noCodeCount + customCount)} hint={`${noCodeCount} no-code · ${customCount} custom`} />
        <StatTile icon={BookOpen} label="Knowledge Bases" value={String(collectionsCount)} />
        <StatTile icon={TrendingUp} label="Containment" value={`${Math.round(containment.rate * 100)}%`} hint={`${containment.containedConversations} of ${containment.totalConversations} conversations`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-muted" />
              <h2 className="text-sm font-semibold text-fg">My agents</h2>
            </div>
            <Link href="/admin/agents/new" className="text-xs text-accent hover:underline">
              + New agent
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {agents.length === 0 && <li className="py-3 text-sm text-muted">No agents yet.</li>}
            {agents.slice(0, 8).map((a) => (
              <li key={a.key} className="flex items-center justify-between py-2.5 text-sm">
                <Link href={`/admin/agents/${a.key}`} className="font-medium text-accent hover:underline">
                  {a.key}
                </Link>
                <span className="text-xs text-muted">v{a.version}</span>
              </li>
            ))}
          </ul>
          {agents.length > 8 && (
            <Link href="/admin/agents" className="mt-3 inline-block text-xs text-accent hover:underline">
              View all {agents.length} →
            </Link>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-muted" />
            <h2 className="text-sm font-semibold text-fg">Volume by agent</h2>
          </div>
          <div className="mt-4">
            <BarList rows={volume.slice(0, 8).map((v) => ({ label: v.agentKey, value: v.runCount }))} />
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench size={16} className="text-muted" />
            <h2 className="text-sm font-semibold text-fg">My tools</h2>
          </div>
          <Link href="/admin/tools/new" className="text-xs text-accent hover:underline">
            + New tool
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:w-80">
          <Link href="/admin/tools" className="rounded-xl border border-border bg-bg p-4 hover:border-accent">
            <p className="text-xl font-semibold text-fg">{noCodeCount}</p>
            <p className="text-xs text-muted">No-code</p>
          </Link>
          <Link href="/admin/tools" className="rounded-xl border border-border bg-bg p-4 hover:border-accent">
            <p className="text-xl font-semibold text-fg">{customCount}</p>
            <p className="text-xs text-muted">Custom</p>
          </Link>
        </div>
      </Card>
    </main>
  );
}
