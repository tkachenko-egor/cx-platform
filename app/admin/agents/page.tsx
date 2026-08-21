import Link from "next/link";
import { getPlatformContext } from "../../../src/platform/context";
import { AgentDefRepository } from "../../../src/db/repositories/agent-def-repository";
import { ModelAliasRepository } from "../../../src/db/repositories/model-alias-repository";
import { displayNameForAlias } from "../../../src/gateway/model-catalog";

export const dynamic = "force-dynamic";

/** Phase 3 M5: agent_defs had no admin UI at all before this — publish/edit was script/seed-driven. Auth/role gate lives in app/admin/layout.tsx. */
export default async function AgentsPage() {
  const { db, tenant } = await getPlatformContext();
  const defs = new AgentDefRepository(db, tenant).listAllPublished();
  const aliasLookup = new Map(new ModelAliasRepository(db, tenant).list().map((a) => [a.alias, a]));

  const latestByKey = new Map<string, (typeof defs)[number]>();
  for (const def of defs) {
    const current = latestByKey.get(def.key);
    if (!current || def.version > current.version) latestByKey.set(def.key, def);
  }
  const agents = [...latestByKey.values()].sort((a, b) => a.key.localeCompare(b.key));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Agents</h1>
        <div className="flex items-center gap-4">
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
            <th className="py-2 pr-4 font-medium">Version</th>
            <th className="py-2 pr-4 font-medium">Model alias</th>
            <th className="py-2 pr-4 font-medium">Tools</th>
            <th className="py-2 font-medium">Handoff targets</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.map((agent) => (
            <tr key={agent.key}>
              <td className="py-2 pr-4">
                <Link href={`/admin/agents/${agent.key}`} className="font-medium text-accent hover:underline">
                  {agent.key}
                </Link>
              </td>
              <td className="py-2 pr-4 text-xs text-muted">v{agent.version}</td>
              <td className="py-2 pr-4 text-xs text-fg">
                {(() => {
                  const resolved = aliasLookup.get(agent.modelAlias);
                  return resolved ? displayNameForAlias(resolved.provider, resolved.model) : agent.modelAlias;
                })()}
              </td>
              <td className="py-2 pr-4 text-xs text-muted">{agent.toolIds.length}</td>
              <td className="py-2 text-xs text-muted">{agent.handoffTargets.length > 0 ? agent.handoffTargets.join(", ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
