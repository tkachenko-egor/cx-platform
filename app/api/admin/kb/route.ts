import { createHash } from "node:crypto";
import { getPlatformContext } from "../../../../src/platform/context";
import { KbArticleRepository, KbChunkRepository } from "../../../../src/db/repositories/kb-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";
import { chunkAndEmbedArticle } from "../../../../src/kb/ingest";

export const runtime = "nodejs";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function GET() {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const articles = new KbArticleRepository(db, tenant).list();
  return Response.json({ articles });
}

/** Phase 4 M3: KB content had no admin UI before this — articles were file-only, ingested via scripts/ingest-kb.ts. Chunking/embedding reuses src/kb/ingest.ts's chunkAndEmbedArticle, not reimplemented here. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    docId?: string;
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
  const docId = body.docId?.trim() || slugify(body.title);
  if (!docId) return Response.json({ error: "Could not derive a doc id from the title — set one explicitly" }, { status: 400 });
  if (articles.getByDocId(docId)) {
    return Response.json({ error: `An article with doc id "${docId}" already exists` }, { status: 400 });
  }

  const contentHash = createHash("sha256").update(body.body).digest("hex");
  const article = articles.upsert({
    docId,
    title: body.title.trim(),
    audience: body.audience?.trim() || "customer",
    effective: body.effective?.trim() || null,
    contentHash,
    body: body.body,
  });

  await chunkAndEmbedArticle(new KbChunkRepository(db, tenant), embeddings, article.id, body.body);

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: "kb_article_created",
    target: article.docId,
    after: { title: article.title, audience: article.audience },
  });

  return Response.json({ ok: true, article });
}
