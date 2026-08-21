import { createHash } from "node:crypto";
import { getPlatformContext } from "../../../../../src/platform/context";
import { KbArticleRepository, KbChunkRepository } from "../../../../../src/db/repositories/kb-repository";
import { KbCollectionRepository } from "../../../../../src/db/repositories/kb-collection-repository";
import { AuditLogRepository } from "../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import { chunkAndEmbedArticle } from "../../../../../src/kb/ingest";
import { syncArticleToVectorStore, removeArticleFromVectorStore } from "../../../../../src/kb/openai-vector-store-sync";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/kb/[docId]">) {
  const { docId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    audience?: string;
    effective?: string | null;
    body?: string;
  };
  if (!body.title?.trim() || !body.body?.trim()) {
    return Response.json({ error: "title and body are required" }, { status: 400 });
  }

  const { db, tenant, embeddings } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const articles = new KbArticleRepository(db, tenant);
  const existing = articles.getByDocId(docId);
  if (!existing) return Response.json({ error: `No article found for doc id "${docId}"` }, { status: 404 });

  const contentHash = createHash("sha256").update(body.body).digest("hex");
  const article = articles.upsert({
    docId,
    title: body.title.trim(),
    audience: body.audience?.trim() || "customer",
    effective: body.effective?.trim() || null,
    contentHash,
    body: body.body,
  });

  if (contentHash !== existing.contentHash) {
    await chunkAndEmbedArticle(new KbChunkRepository(db, tenant), embeddings, article.id, body.body);
  }

  if (article.collectionId) {
    const collection = new KbCollectionRepository(db, tenant).getById(article.collectionId);
    if (collection?.openaiVectorStoreId) {
      await syncArticleToVectorStore(db, tenant, collection.openaiVectorStoreId, article).catch((err) => console.error(`File Search sync failed for article "${article.docId}":`, err));
    }
  }

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "kb_article_updated",
    target: article.docId,
    before: { title: existing.title, audience: existing.audience },
    after: { title: article.title, audience: article.audience },
  });

  return Response.json({ ok: true, article });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/kb/[docId]">) {
  const { docId } = await ctx.params;
  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const articles = new KbArticleRepository(db, tenant);
  const existing = articles.getByDocId(docId);
  if (!existing) return Response.json({ error: `No article found for doc id "${docId}"` }, { status: 404 });

  if (existing.collectionId && existing.openaiFileId) {
    const collection = new KbCollectionRepository(db, tenant).getById(existing.collectionId);
    if (collection?.openaiVectorStoreId) {
      await removeArticleFromVectorStore(db, tenant, collection.openaiVectorStoreId, existing.openaiFileId).catch((err) => console.error(`File Search removal failed for article "${docId}":`, err));
    }
  }

  new KbChunkRepository(db, tenant).replaceForArticle(existing.id, []);
  articles.delete(docId);

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "kb_article_deleted",
    target: docId,
    before: { title: existing.title },
  });

  return Response.json({ ok: true });
}
