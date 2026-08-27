import { getPlatformContext } from "../../../src/platform/context";
import { requireAdminPage } from "../../../src/auth/require-admin-page";
import { AgentDefRepository } from "../../../src/db/repositories/agent-def-repository";
import { AgentExperimentRepository } from "../../../src/db/repositories/agent-experiment-repository";
import { ExperimentForm } from "../../../components/admin/ExperimentForm";

export const dynamic = "force-dynamic";

/** Phase 2 M6a: no admin surface for agent_defs existed before this — publish is otherwise script/seed-driven. Base auth gate lives in app/admin/layout.tsx; this page is additionally admin+-only (Phase 8 M3) since the layout now admits supervisors too. */
export default async function ExperimentsPage() {
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);

  const agentVersions = (await new AgentDefRepository(db, tenant).listAllPublished()).map((a) => ({ key: a.key, version: a.version }));
  const experiments = await new AgentExperimentRepository(db, tenant).list();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Agent experiments</h1>
      <p className="mt-1 text-sm text-muted">A/B test two published versions of the same agent — new conversations split deterministically by traffic weight; existing conversations keep the version they were pinned to.</p>

      <ExperimentForm agentVersions={agentVersions} experiments={experiments} />
    </main>
  );
}
