import "dotenv/config";
import { getDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { OpenAiEmbeddingProvider } from "../src/gateway/embeddings/openai";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";

/** FR-7.2: re-run this after editing knowledge/*.md — only changed articles get re-embedded. */
async function main() {
  const db = getDb();
  const tenant = new TenantRepository(db).getBySlug("demo");
  if (!tenant) throw new Error('Tenant "demo" not found — run `npm run seed` first.');

  const embeddings = process.env.OPENAI_API_KEY ? new OpenAiEmbeddingProvider(process.env.OPENAI_API_KEY) : new StubEmbeddingProvider();
  const { ingested, skipped } = await ingestKnowledgeBase(db, tenant, embeddings);
  console.log(`Ingested: ${ingested.join(", ") || "(none)"}`);
  console.log(`Skipped (unchanged): ${skipped.join(", ") || "(none)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
