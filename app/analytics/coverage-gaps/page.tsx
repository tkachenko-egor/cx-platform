import { redirect } from "next/navigation";
import { getPlatformContext } from "../../../src/platform/context";
import { getCoverageGaps } from "../../../src/analytics/coverage";
import { getSessionUser } from "../../../src/auth/session";
import { SignOutButton } from "../../../components/desk/SignOutButton";

export const dynamic = "force-dynamic";

/** FR-7.10/11.9: low-confidence retrievals as a worklist for KB authors — first page of the Phase 2 app/analytics/ surface. */
export default async function CoverageGapsPage() {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");

  const gaps = getCoverageGaps(db, tenant);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Coverage gaps</h1>
        <p className="flex items-center gap-2 text-xs text-muted">
          {user.email} · {user.role}
          <SignOutButton />
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">Customer questions where KB retrieval found nothing it was confident about — candidates for a new or improved article.</p>

      {gaps.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No low-confidence retrievals recorded yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
          {gaps.map((g, i) => (
            <li key={i} className="px-4 py-3 text-sm">
              <p className="text-fg">{g.queryText}</p>
              <p className="mt-1 text-xs text-muted">
                score {g.bestScore.toFixed(4)} · {g.retrievedDocIds.length > 0 ? `closest: ${g.retrievedDocIds.join(", ")}` : "no candidates matched"} · {new Date(g.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
