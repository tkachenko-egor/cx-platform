import { createHash } from "node:crypto";
import { getPlatformContext } from "../../../../../../src/platform/context";
import { KbArticleRepository, KbChunkRepository } from "../../../../../../src/db/repositories/kb-repository";
import { KbCollectionRepository } from "../../../../../../src/db/repositories/kb-collection-repository";
import { AuditLogRepository } from "../../../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../../../src/auth/require-role";
import { chunkAndEmbedArticle, extractH1Title, parseFrontMatter } from "../../../../../../src/kb/ingest";
import { extractPdfText } from "../../../../../../src/kb/pdf-extract";

export const runtime = "nodejs";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Phase 5 M2: import an article from a .md or .pdf file instead of typing
 * it — reuses the same frontmatter parsing scripts/ingest-kb.ts uses
 * (src/kb/ingest.ts's parseFrontMatter) and the same chunk/embed pipeline
 * as manual entry, nothing duplicated. Lives under kb-collections/[id]
 * rather than kb/[collectionId] — Next.js requires every dynamic segment
 * at the same path position to share one param name, and app/api/admin/kb/
 * already has [docId] at that position.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/kb-collections/[id]/import">) {
  const { id: collectionId } = await ctx.params;
  const { db, tenant, embeddings } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  if (!new KbCollectionRepository(db, tenant).getById(collectionId)) {
    return Response.json({ error: "Knowledge Base not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with a file field" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });

  const name = file.name;
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  const baseName = name.replace(/\.[^.]+$/, "");

  let title = baseName;
  let audience = "customer";
  let effective: string | null = null;
  let bodyText: string;
  let docId: string;

  if (ext === ".md") {
    const raw = await file.text();
    const { meta, body } = parseFrontMatter(raw);
    docId = meta.doc_id ?? slugify(baseName);
    title = meta.title ?? extractH1Title(body) ?? baseName;
    audience = meta.audience ?? "customer";
    effective = meta.effective ?? null;
    bodyText = body;
  } else if (ext === ".pdf") {
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      bodyText = await extractPdfText(buffer);
    } catch (err) {
      return Response.json({ error: `Could not read this PDF: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 });
    }
    docId = slugify(baseName);
  } else {
    return Response.json({ error: "Only .md and .pdf files are supported" }, { status: 400 });
  }

  if (!bodyText.trim()) {
    return Response.json({ error: "No text could be extracted from this file" }, { status: 400 });
  }
  if (!docId) return Response.json({ error: "Could not derive a doc id from the filename" }, { status: 400 });

  const articles = new KbArticleRepository(db, tenant);
  if (articles.getByDocId(docId)) {
    return Response.json({ error: `An article with doc id "${docId}" already exists` }, { status: 400 });
  }

  const contentHash = createHash("sha256").update(bodyText).digest("hex");
  const article = articles.upsert({ docId, title, audience, effective, contentHash, body: bodyText, collectionId });
  await chunkAndEmbedArticle(new KbChunkRepository(db, tenant), embeddings, article.id, bodyText);

  new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "kb_article_imported", target: article.docId, after: { title, source: ext } });

  return Response.json({ ok: true, article });
}
