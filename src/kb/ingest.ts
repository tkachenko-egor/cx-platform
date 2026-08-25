import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import type { TenantContext } from "../tenancy/context";
import { KbArticleRepository, KbChunkRepository } from "../db/repositories/kb-repository";
import { KbCollectionRepository } from "../db/repositories/kb-collection-repository";
import { chunkMarkdown, estimateTokenCount } from "./chunking";

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");

interface ParsedDoc {
  docId: string;
  title: string;
  effective: string | null;
  audience: string;
  body: string;
  raw: string;
}

/** Same frontmatter shape as amarelle-handoff's lib/agent/knowledge.ts. Exported for reuse by the admin .md import path (Phase 5 M2). */
export function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: match[2].trim() };
}

/** KB-02: falls back to the body's first Markdown `# heading` when there's no explicit `title:` frontmatter — a filename like "03-warranty-support.md" is a worse title than the article's own `# Nimbus Goods — Warranty & Product Support` and shouldn't win by default. */
export function extractH1Title(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

export function loadKnowledgeDocs(dir: string = KNOWLEDGE_DIR): ParsedDoc[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const { meta, body } = parseFrontMatter(raw);
    return {
      docId: meta.doc_id ?? file.replace(/\.md$/, ""),
      title: meta.title ?? file,
      effective: meta.effective ?? null,
      audience: meta.audience ?? "customer",
      body,
      raw,
    };
  });
}

/**
 * Chunks + embeds one article's body and (re)stores its chunks — the one
 * piece of real work either the file-based CLI ingest or the admin KB
 * editor (Phase 4 M3) needs, kept in one place so neither reimplements
 * chunking/embedding.
 */
export async function chunkAndEmbedArticle(
  chunks: KbChunkRepository,
  embeddings: EmbeddingProvider,
  articleId: string,
  body: string,
): Promise<void> {
  const raw = chunkMarkdown(body);
  const vectors = await embeddings.embed(raw.map((c) => c.text));
  chunks.replaceForArticle(
    articleId,
    raw.map((c, i) => ({
      ordinal: i,
      heading: c.heading,
      text: c.text,
      embedding: vectors[i],
      embeddingModel: embeddings.model,
      tokenCount: estimateTokenCount(c.text),
    })),
  );
}

/**
 * FR-7.2: only re-chunks/re-embeds an article whose content actually
 * changed (compared by content_hash). Whole-article granularity, not
 * per-chunk delta — a reasonable Phase-1 simplification given the corpus
 * size (a handful of short docs).
 */
export async function ingestKnowledgeBase(
  db: Database.Database,
  tenant: TenantContext,
  embeddings: EmbeddingProvider,
  dir: string = KNOWLEDGE_DIR,
): Promise<{ ingested: string[]; skipped: string[] }> {
  const articles = new KbArticleRepository(db, tenant);
  const chunks = new KbChunkRepository(db, tenant);
  const collections = new KbCollectionRepository(db, tenant);
  const docs = loadKnowledgeDocs(dir);

  const ingested: string[] = [];
  const skipped: string[] = [];
  let defaultCollectionId: string | undefined;

  for (const doc of docs) {
    const contentHash = createHash("sha256").update(doc.raw).digest("hex");
    const existing = articles.getByDocId(doc.docId);
    if (existing && existing.contentHash === contentHash) {
      skipped.push(doc.docId);
      continue;
    }

    // Fresh installs: migration 018's backfill only catches articles that existed at migration time,
    // so a brand-new file-sourced article (post-seed) still needs somewhere to land. Only resolved
    // lazily/once — most ingest runs touch zero new articles (FR-7.2's skip-unchanged path above).
    if (!existing?.collectionId && !defaultCollectionId) {
      defaultCollectionId = collections.ensureDefault().id;
    }

    const article = articles.upsert({
      docId: doc.docId,
      title: doc.title,
      audience: doc.audience,
      effective: doc.effective,
      contentHash,
      collectionId: existing?.collectionId ?? defaultCollectionId,
    });
    await chunkAndEmbedArticle(chunks, embeddings, article.id, doc.body);
    ingested.push(doc.docId);
  }

  return { ingested, skipped };
}
