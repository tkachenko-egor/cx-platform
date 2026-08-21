import { getPlatformContext } from "../../../src/platform/context";
import { AuditLogRepository } from "../../../src/db/repositories/audit-log-repository";
import { UserRepository } from "../../../src/db/repositories/user-repository";
import { AuditLogTable } from "../../../components/admin/AuditLogTable";

export const dynamic = "force-dynamic";

/** Phase 3 M3, restyled in the design refresh. Auth/role gate lives in app/admin/layout.tsx. */
export default async function AuditLogPage() {
  const { db, tenant } = await getPlatformContext();

  const entries = new AuditLogRepository(db, tenant).listRecent({ limit: 100 });
  const usersById = new Map(new UserRepository(db, tenant).list().map((u) => [u.id, u.email]));

  const rows = entries.map((entry) => ({
    id: entry.id,
    createdAtFormatted: new Date(entry.createdAt).toLocaleString(),
    actor: entry.actorUserId ? (usersById.get(entry.actorUserId) ?? entry.actorUserId) : "system",
    action: entry.action,
    target: entry.target,
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Audit log</h1>
      <p className="mt-1 text-sm text-muted">Privileged actions — config changes, tool-write approvals, role changes.</p>

      {rows.length === 0 ? <p className="mt-6 text-sm text-muted">No audit entries yet.</p> : <AuditLogTable entries={rows} />}
    </main>
  );
}
