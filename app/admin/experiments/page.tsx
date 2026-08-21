import { redirect } from "next/navigation";
import { getPlatformContext } from "../../../src/platform/context";
import { AgentDefRepository } from "../../../src/db/repositories/agent-def-repository";
import { AgentExperimentRepository } from "../../../src/db/repositories/agent-experiment-repository";
import { getSessionUser } from "../../../src/auth/session";
import { roleAtLeast } from "../../../src/auth/permissions";
import { SignOutButton } from "../../../components/desk/SignOutButton";
import { ExperimentForm } from "../../../components/admin/ExperimentForm";

export const dynamic = "force-dynamic";

/** Phase 2 M6a: no admin surface for agent_defs existed before this — publish is otherwise script/seed-driven. */
export default async function ExperimentsPage() {
  const { db, tenant } = getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");
  if (!roleAtLeast(user.role, "admin")) redirect("/desk");

  const agentVersions = new AgentDefRepository(db, tenant).listAllPublished().map((a) => ({ key: a.key, version: a.version }));
  const experiments = new AgentExperimentRepository(db, tenant).list();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Agent experiments</h1>
        <p className="flex items-center gap-2 text-xs text-muted">
          {user.email} · {user.role}
          <SignOutButton />
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">A/B test two published versions of the same agent — new conversations split deterministically by traffic weight; existing conversations keep the version they were pinned to.</p>

      <ExperimentForm agentVersions={agentVersions} experiments={experiments} />
    </main>
  );
}
