import { getPlatformContext } from "../../../src/platform/context";
import { KbArticleRepository } from "../../../src/db/repositories/kb-repository";
import { KbManagement } from "../../../components/admin/KbManagement";

export const dynamic = "force-dynamic";

/** Phase 4 M3: KB content had no admin editor before this — file-sourced articles (knowledge/*.md, scripts/ingest-kb.ts) are listed alongside admin-created ones. Auth/role gate lives in app/admin/layout.tsx. */
export default async function KbPage() {
  const { db, tenant } = await getPlatformContext();

  const articles = new KbArticleRepository(db, tenant)
    .list()
    .map((a) => ({ docId: a.docId, title: a.title, audience: a.audience, effective: a.effective, body: a.body, isFileSourced: a.body === "" }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Knowledge base</h1>
      <p className="mt-1 text-sm text-muted">
        Articles agents can cite as [doc_id]. An agent only retrieves from audiences listed in its KB scope (defaults to &quot;customer&quot;). File-sourced articles
        (from <code className="text-xs">knowledge/*.md</code>) are read-only here — edit the file and re-run ingest instead.
      </p>

      <KbManagement articles={articles} />
    </main>
  );
}
