import { getPlatformContext } from "../../../../src/platform/context";
import { AgentDefRepository } from "../../../../src/db/repositories/agent-def-repository";
import { FlowCanvas } from "../../../../components/admin/FlowCanvas";

export const dynamic = "force-dynamic";

/** Phase 3 M6: visual flow builder — reads/writes agent_defs.handoffTargets via M5's AgentDefRepository.publish(), no new repository code. Auth/role gate lives in app/admin/layout.tsx. */
export default async function FlowBuilderPage() {
  const { db, tenant } = await getPlatformContext();
  const defs = new AgentDefRepository(db, tenant).listAllPublished();

  const latestByKey = new Map<string, (typeof defs)[number]>();
  for (const def of defs) {
    const current = latestByKey.get(def.key);
    if (!current || def.version > current.version) latestByKey.set(def.key, def);
  }
  const nodes = [...latestByKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((agent) => ({ key: agent.key, skills: agent.skills, handoffTargets: agent.handoffTargets }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Flow builder</h1>
      <p className="mt-1 text-sm text-muted">Router → specialist handoff wiring, visualized. Each change publishes a new agent_defs version for the edited agent.</p>

      <FlowCanvas initialNodes={nodes} />
    </main>
  );
}
