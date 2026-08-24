import { getPlatformContext } from "../../../src/platform/context";
import { requireAdminPage } from "../../../src/auth/require-admin-page";
import { KbCollectionRepository } from "../../../src/db/repositories/kb-collection-repository";
import { KbCollectionsManagement } from "../../../components/admin/KbCollectionsManagement";

export const dynamic = "force-dynamic";

/** Phase 5 M1-M2: Knowledge Bases — before this, KB content was one flat, ungrouped list of articles per tenant. Admin+-only (Phase 8 M3) — see app/admin/layout.tsx's comment. */
export default async function KbCollectionsPage() {
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);

  const collections = new KbCollectionRepository(db, tenant);
  const rows = collections.list().map((c) => ({ ...c, articleCount: collections.countArticles(c.id) }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Knowledge Bases</h1>
      <p className="mt-1 text-sm text-muted">Named collections of articles an agent can draw from — one agent can use several, and a KB can be shared across agents.</p>

      <KbCollectionsManagement collections={rows} />
    </main>
  );
}
