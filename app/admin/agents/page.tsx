import Link from "next/link";
import { getPlatformContext } from "../../../src/platform/context";
import { AgentDefRepository } from "../../../src/db/repositories/agent-def-repository";
import { ModelAliasRepository } from "../../../src/db/repositories/model-alias-repository";
import { displayNameForAlias, isStubProvider } from "../../../src/gateway/model-catalog";
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
  const agents = [...latestByKey.values()]
    .filter((a) => showArchived || a.agentStatus !== "archived")
    .sort((a, b) => (a.displayName || a.key).localeCompare(b.displayName || b.key));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Agents</h1>
          <p className="mt-1 text-sm text-muted">
            {agents.length} agent{agents.length === 1 ? "" : "s"} · latest published version of each. Editing always publishes a new version — existing
            conversations keep the version they started on.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link href={showArchived ? "/admin/agents" : "/admin/agents?archived=1"} className="text-xs text-muted hover:underline">
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          <Link
            href="/admin/agents/new"
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            + New agent
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-bg text-xs text-muted">
              <th className="py-3 pl-5 pr-4 font-medium">Name</th>
              <th className="py-3 pr-4 font-medium">Status</th>
              <th className="py-3 pr-4 font-medium">Environment</th>
              <th className="py-3 pr-4 font-medium">Version</th>
              <th className="py-3 pr-4 font-medium">Model alias</th>
              <th className="py-3 pr-4 font-medium">Tools</th>
              <th className="py-3 pr-4 font-medium">Handoff targets</th>
              <th className="py-3 pr-5 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agents.map((agent) => {
              const name = agent.displayName || agent.key;
              return (
                <tr key={agent.key} className="group transition-colors hover:bg-bg">
                  <td className="py-3 pl-5 pr-4">
                    <Link href={`/admin/agents/${agent.key}`} className="flex items-center gap-3">
                      <AgentAvatar name={name} avatarUrl={agent.avatarUrl} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg group-hover:text-accent">{name}</span>
                        {agent.displayName && <span className="block truncate font-mono text-[11px] text-muted">{agent.key}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={STATUS_VARIANT[agent.agentStatus]}>{agent.agentStatus}</Badge>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={agent.environment === "sandbox" ? "warning" : "neutral"}>{agent.environment}</Badge>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted">v{agent.version}</td>
                  <td className="py-3 pr-4 text-xs text-fg">
                    {(() => {
                      const resolved = aliasLookup.get(agent.modelAlias);
                      const label = resolved ? displayNameForAlias(resolved.provider, resolved.model) : agent.modelAlias;
                      const isStub = resolved ? isStubProvider(resolved.provider) : false;
                      if (!isStub) return label;
                      return (
                        <span className="flex items-center gap-1.5">
                          {label}
                          <Badge variant="danger" title="Zero-network dev fixture that echoes input — not a real model. Answers reaching customers on this agent are not from an LLM.">
                            stub
                          </Badge>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted">{agent.toolIds.length}</td>
                  <td className="py-3 pr-4 text-xs text-muted">{agent.handoffTargets.length > 0 ? agent.handoffTargets.join(", ") : "—"}</td>
                  <td className="py-3 pr-5 text-right">{agent.agentStatus !== "archived" && <DeleteAgentButton agentKey={agent.key} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-cyan-100 text-cyan-700",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Small identity glyph for an agent row: its avatar image if set, otherwise a color-coded initial derived from its name. */
function AgentAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- admin-configured external URL, not a local asset
    return <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${colorForName(name)}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
