import { getPlatformContext } from "../../../../src/platform/context";
import { requireAdminPage } from "../../../../src/auth/require-admin-page";
import { AgentPublishApprovalRepository } from "../../../../src/db/repositories/agent-publish-approval-repository";
import { UserRepository } from "../../../../src/db/repositories/user-repository";
import { AgentApprovalsList } from "../../../../components/admin/AgentApprovalsList";

export const dynamic = "force-dynamic";

/** Phase 8 M3: where an admin/owner reviews a supervisor's attempt to publish an agent live. Admin+-only. */
export default async function AgentApprovalsPage() {
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);

  const usersById = new Map(new UserRepository(db, tenant).list().map((u) => [u.id, u.email]));
  const items = new AgentPublishApprovalRepository(db, tenant)
    .listPending()
    .map((a) => ({
      id: a.id,
      agentKey: a.agentKey,
      requestedByEmail: usersById.get(a.requestedBy) ?? a.requestedBy,
      requestedVersion: a.requestedVersion,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      fromEnvironment: a.fromEnvironment,
      toEnvironment: a.toEnvironment,
      requestedAt: new Date(a.createdAt).toLocaleString(),
    }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Publish approvals</h1>
      <p className="mt-1 text-sm text-muted">A supervisor&apos;s attempt to publish an agent live (active status, production environment) waits here until an admin or owner approves it.</p>

      <AgentApprovalsList items={items} />
    </main>
  );
}
