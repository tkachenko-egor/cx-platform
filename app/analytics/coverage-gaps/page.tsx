import { redirect } from "next/navigation";
import { getPlatformContext } from "../../../src/platform/context";
import { getCoverageGaps } from "../../../src/analytics/coverage";
import { getSessionUser } from "../../../src/auth/session";
import { Card } from "../../../components/ui/Card";
import { Tabs } from "../../../components/ui/Tabs";

export const dynamic = "force-dynamic";

/** FR-7.10/11.9: low-confidence retrievals as a worklist for KB authors — first page of the Phase 2 app/analytics/ surface. */
export default async function CoverageGapsPage() {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");

  const gaps = getCoverageGaps(db, tenant);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Coverage gaps</h1>
      <p className="mt-1 text-sm text-muted">Customer questions where KB retrieval found nothing it was confident about — candidates for a new or improved article.</p>

      <div className="mt-4">
        <Tabs active="/analytics/coverage-gaps" items={[{ href: "/analytics", label: "Overview" }, { href: "/analytics/coverage-gaps", label: "Coverage gaps" }]} />
      </div>

      {gaps.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No low-confidence retrievals recorded yet.</p>
      ) : (
        <Card className="mt-6 divide-y divide-border">
          {gaps.map((g, i) => (
            <div key={i} className="px-4 py-3 text-sm">
              <p className="text-fg">{g.queryText}</p>
              <p className="mt-1 text-xs text-muted">
                score {g.bestScore.toFixed(4)} · {g.retrievedDocIds.length > 0 ? `closest: ${g.retrievedDocIds.join(", ")}` : "no candidates matched"} · {new Date(g.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </Card>
      )}
    </main>
  );
}
