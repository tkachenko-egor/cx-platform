import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPlatformContext } from "../../../../src/platform/context";
import { requireAdminPage } from "../../../../src/auth/require-admin-page";
import { KbArticleRepository, KbChunkRepository } from "../../../../src/db/repositories/kb-repository";
import { KbCollectionRepository } from "../../../../src/db/repositories/kb-collection-repository";
import { KbArticlesManagement } from "../../../../components/admin/KbArticlesManagement";

export const dynamic = "force-dynamic";

/** Admin+-only (Phase 8 M3) — see app/admin/layout.tsx's comment. */
export default async function KbCollectionPage(props: PageProps<"/admin/kb/[collectionId]">) {
  const { collectionId } = await props.params;
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);

  const collection = new KbCollectionRepository(db, tenant).getById(collectionId);
  if (!collection) notFound();

  const articleRows = new KbArticleRepository(db, tenant).list({ collectionId });
  const chunkCounts = new KbChunkRepository(db, tenant).countByArticleIds(articleRows.map((a) => a.id));
  const articles = articleRows.map((a) => ({
    docId: a.docId,
    title: a.title,
    audience: a.audience,
    effective: a.effective,
    body: a.body,
    isFileSourced: a.body === "",
    chunkCount: chunkCounts.get(a.id) ?? 0,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/admin/kb" className="flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft size={13} /> Knowledge Bases
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-fg">{collection.name}</h1>
      <p className="mt-1 text-sm text-muted">{collection.description || "No description"}</p>

      <KbArticlesManagement collectionId={collectionId} articles={articles} />
    </main>
  );
}
