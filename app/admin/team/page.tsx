import { getPlatformContext } from "../../../src/platform/context";
import { getSessionUser } from "../../../src/auth/session";
import { UserRepository } from "../../../src/db/repositories/user-repository";
import { UserInviteRepository } from "../../../src/db/repositories/user-invite-repository";
import { TeamManagement } from "../../../components/admin/TeamManagement";

export const dynamic = "force-dynamic";

/** Phase 3 M3: team/role management — the first real consumer of the manage_users permission. Auth/role gate lives in app/admin/layout.tsx. */
export default async function TeamPage() {
  const { db, tenant } = await getPlatformContext();
  const currentUser = (await getSessionUser(db, tenant))!;

  const users = new UserRepository(db, tenant).list().map((u) => ({ id: u.id, email: u.email, role: u.role, status: u.status }));
  const invites = new UserInviteRepository(db, tenant).listPending().map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAtFormatted: new Date(i.expiresAt).toLocaleDateString() }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Team</h1>
      <p className="mt-1 text-sm text-muted">Invite staff, reassign roles, or deactivate an account.</p>

      <TeamManagement users={users} invites={invites} currentUserId={currentUser.id} />
    </main>
  );
}
