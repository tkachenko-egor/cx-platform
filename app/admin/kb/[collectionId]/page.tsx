import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPlatformContext } from "../../../../src/platform/context";
import { KbArticleRepository } from "../../../../src/db/repositories/kb-repository";
import { KbCollectionRepository } from "../../../../src/db/repositories/kb-collection-repository";
import { KbArticlesManagement } from "../../../../components/admin/KbArticlesManagement";

export const dynamic = "force-dynamic";

export default async function KbCollectionPage(props: PageProps<"/admin/kb/[collectionId]">) {
  const { collectionId } = await props.params;
  const { db, tenant } = await getPlatformContext();

  const collection = new KbCollectionRepository(db, tenant).getById(collectionId);
  if (!collection) notFound();

  const articles = new KbArticleRepository(db, tenant)
    .list({ collectionId })
    .map((a) => ({ docId: a.docId, title: a.title, audience: a.audience, effective: a.effective, body: a.body, isFileSourced: a.body === "" }));

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
