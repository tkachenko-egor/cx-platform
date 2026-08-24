import Link from "next/link";
import { getPlatformContext } from "../../../src/platform/context";
import { AgentDefRepository } from "../../../src/db/repositories/agent-def-repository";
import { ModelAliasRepository } from "../../../src/db/repositories/model-alias-repository";
import { displayNameForAlias } from "../../../src/gateway/model-catalog";
import { Badge } from "../../../components/ui/Badge";
import { DeleteAgentButton } from "../../../components/admin/DeleteAgentButton";

const STATUS_VARIANT = { draft: "neutral", active: "success", paused: "warning", archived: "neutral" } as const;

export const dynamic = "force-dynamic";

/** Phase 3 M5: agent_defs had no admin UI at all before this — publish/edit was script/seed-driven. Auth/role gate lives in app/admin/layout.tsx. */
export default async function AgentsPage(props: { searchParams: Promise<{ archived?: string }> }) {
  const { archived } = await props.searchParams;
  const showArchived = archived === "1";
  const { db, tenant } = await getPlatformContext();
  const defs = new AgentDefRepository(db, tenant).listAllPublished();
  const aliasLookup = new Map(new ModelAliasRepository(db, tenant).list().map((a) => [a.alias, a]));

  const latestByKey = new Map<string, (typeof defs)[number]>();
  for (const def of defs) {
    const current = latestByKey.get(def.key);
    if (!current || def.version > current.version) latestByKey.set(def.key, def);
  }
  // Milestone 5 (Archive = delete): archived agents drop out of the default
  // view — still reachable via ?archived=1 rather than hidden with no way back.
  const agents = [...latestByKey.values()].filter((a) => showArchived || a.agentStatus !== "archived").sort((a, b) => a.key.localeCompare(b.key));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Agents</h1>
        <div className="flex items-center gap-4">
          <Link href={showArchived ? "/admin/agents" : "/admin/agents?archived=1"} className="text-xs text-muted hover:underline">
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          <Link href="/admin/agents/new" className="text-xs text-accent hover:underline">
            + New agent
          </Link>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">Latest published version of each agent. Editing always publishes a new version — existing conversations keep the version they started on.</p>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th className="py-2 pr-4 font-medium">Key</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Environment</th>
            <th className="py-2 pr-4 font-medium">Version</th>
            <th className="py-2 pr-4 font-medium">Model alias</th>
            <th className="py-2 pr-4 font-medium">Tools</th>
            <th className="py-2 pr-4 font-medium">Handoff targets</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.map((agent) => (
            <tr key={agent.key}>
              <td className="py-2 pr-4">
                <Link href={`/admin/agents/${agent.key}`} className="font-medium text-accent hover:underline">
                  {agent.displayName || agent.key}
                </Link>
                {agent.displayName && <span className="ml-1.5 font-mono text-[11px] text-muted">{agent.key}</span>}
              </td>
              <td className="py-2 pr-4">
                <Badge variant={STATUS_VARIANT[agent.agentStatus]}>{agent.agentStatus}</Badge>
              </td>
              <td className="py-2 pr-4">
                <Badge variant={agent.environment === "sandbox" ? "warning" : "neutral"}>{agent.environment}</Badge>
              </td>
              <td className="py-2 pr-4 text-xs text-muted">v{agent.version}</td>
              <td className="py-2 pr-4 text-xs text-fg">
                {(() => {
                  const resolved = aliasLookup.get(agent.modelAlias);
                  return resolved ? displayNameForAlias(resolved.provider, resolved.model) : agent.modelAlias;
                })()}
              </td>
              <td className="py-2 pr-4 text-xs text-muted">{agent.toolIds.length}</td>
              <td className="py-2 pr-4 text-xs text-muted">{agent.handoffTargets.length > 0 ? agent.handoffTargets.join(", ") : "—"}</td>
              <td className="py-2 text-right">{agent.agentStatus !== "archived" && <DeleteAgentButton agentKey={agent.key} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
