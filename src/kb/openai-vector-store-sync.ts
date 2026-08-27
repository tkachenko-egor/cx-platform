import type { TenantContext } from "../tenancy/context";
import type { SqlDatabase } from "../db/pg";
import { ProviderCredentialRepository } from "../db/repositories/provider-credential-repository";
import { KbCollectionRepository } from "../db/repositories/kb-collection-repository";
import { KbArticleRepository, type KbArticle } from "../db/repositories/kb-repository";

const FILES_ENDPOINT = "https://api.openai.com/v1/files";
const VECTOR_STORES_ENDPOINT = "https://api.openai.com/v1/vector_stores";

/**
 * Phase 6 M3: raw-fetch sync between a KB collection and an OpenAI vector
 * store, so an agent's File Search native tool can search this tenant's own
 * knowledge base. Same no-SDK convention as src/gateway/embeddings/openai.ts
 * and src/gateway/providers/openai.ts. Every function is a no-op (resolves
 * without throwing) when no OpenAI credential is configured — File Search
 * just silently has nothing to search, same fallback style as embeddings.
 */

async function getApiKey(db: SqlDatabase, tenant: TenantContext): Promise<string | undefined> {
  return (await new ProviderCredentialRepository(db, tenant).getActiveLlmKey("openai"))?.decryptedKey ?? process.env.OPENAI_API_KEY;
}

/** Creates the collection's vector store on first use and backfills its existing articles. Returns the vector store id, or undefined if no OpenAI credential is configured. Already-provisioned collections just return their existing id. */
export async function ensureVectorStore(db: SqlDatabase, tenant: TenantContext, collectionId: string): Promise<string | undefined> {
  const collections = new KbCollectionRepository(db, tenant);
  const collection = await collections.getById(collectionId);
  if (!collection) return undefined;
  if (collection.openaiVectorStoreId) return collection.openaiVectorStoreId;

  const apiKey = await getApiKey(db, tenant);
  if (!apiKey) return undefined;

  const res = await fetch(VECTOR_STORES_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ name: `${tenant.tenantId}:${collection.name}` }),
  });
  if (!res.ok) throw new Error(`Could not create OpenAI vector store: ${await res.text().catch(() => res.statusText)}`);
  const body = (await res.json()) as { id: string };
  await collections.setOpenAiVectorStoreId(collectionId, body.id);

  const articles = await new KbArticleRepository(db, tenant).list({ collectionId });
  for (const article of articles) {
    await syncArticleToVectorStore(db, tenant, body.id, article);
  }

  return body.id;
}

/** Uploads (or re-uploads, since OpenAI files are immutable) one article's content and attaches it to the vector store. No-op if no OpenAI credential is configured. */
export async function syncArticleToVectorStore(db: SqlDatabase, tenant: TenantContext, vectorStoreId: string, article: KbArticle): Promise<void> {
  const apiKey = await getApiKey(db, tenant);
  if (!apiKey) return;

  if (article.openaiFileId) {
    await removeArticleFromVectorStore(db, tenant, vectorStoreId, article.openaiFileId);
  }

  const form = new FormData();
  const text = article.body || article.title;
  form.set("file", new Blob([text], { type: "text/markdown" }), `${article.docId}.md`);
  form.set("purpose", "assistants");

  const fileRes = await fetch(FILES_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!fileRes.ok) throw new Error(`Could not upload KB article "${article.docId}" to OpenAI: ${await fileRes.text().catch(() => fileRes.statusText)}`);
  const file = (await fileRes.json()) as { id: string };

  const attachRes = await fetch(`${VECTOR_STORES_ENDPOINT}/${vectorStoreId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ file_id: file.id }),
  });
  if (!attachRes.ok) throw new Error(`Could not attach KB article "${article.docId}" to its vector store: ${await attachRes.text().catch(() => attachRes.statusText)}`);

  await new KbArticleRepository(db, tenant).setOpenAiFileId(article.docId, file.id);
}

/** Detaches + deletes a previously-uploaded article file. Best-effort — failures here shouldn't block the admin action that triggered them. */
export async function removeArticleFromVectorStore(db: SqlDatabase, tenant: TenantContext, vectorStoreId: string, openaiFileId: string): Promise<void> {
  const apiKey = await getApiKey(db, tenant);
  if (!apiKey) return;
  const headers = { Authorization: `Bearer ${apiKey}` };
  await fetch(`${VECTOR_STORES_ENDPOINT}/${vectorStoreId}/files/${openaiFileId}`, { method: "DELETE", headers }).catch(() => undefined);
  await fetch(`${FILES_ENDPOINT}/${openaiFileId}`, { method: "DELETE", headers }).catch(() => undefined);
}

/** Deletes the vector store itself (a collection's articles no longer need remote sync). Best-effort. */
export async function deleteVectorStore(db: SqlDatabase, tenant: TenantContext, vectorStoreId: string): Promise<void> {
  const apiKey = await getApiKey(db, tenant);
  if (!apiKey) return;
  await fetch(`${VECTOR_STORES_ENDPOINT}/${vectorStoreId}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => undefined);
}
