import { getPlatformContext } from "../../../src/platform/context";
import { AuditLogRepository } from "../../../src/db/repositories/audit-log-repository";
import { UserRepository } from "../../../src/db/repositories/user-repository";

export const dynamic = "force-dynamic";

/** Phase 3 M3: table-based, no charting dependency — matches app/analytics/page.tsx's convention. Auth/role gate lives in app/admin/layout.tsx. */
export default async function AuditLogPage() {
  const { db, tenant } = await getPlatformContext();

  const entries = new AuditLogRepository(db, tenant).listRecent({ limit: 100 });
  const usersById = new Map(new UserRepository(db, tenant).list().map((u) => [u.id, u.email]));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Audit log</h1>
      <p className="mt-1 text-sm text-muted">Privileged actions — config changes, tool-write approvals, role changes.</p>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No audit entries yet.</p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">Actor</th>
              <th className="py-2 pr-4 font-medium">Action</th>
              <th className="py-2 font-medium">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="py-2 pr-4 text-xs text-muted">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="py-2 pr-4">{entry.actorUserId ? (usersById.get(entry.actorUserId) ?? entry.actorUserId) : "system"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{entry.action}</td>
                <td className="py-2 font-mono text-xs text-muted">{entry.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
