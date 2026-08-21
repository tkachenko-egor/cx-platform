import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { chunkMarkdown } from "../src/kb/chunking";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { hybridSearch } from "../src/kb/retrieval";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "knowledge");

describe("chunkMarkdown", () => {
  it("splits on H2 headings and keeps a table intact within one chunk", () => {
    const body = ["# Title", "intro line", "", "## Section A", "a1", "a2", "", "## Section B", "| h1 | h2 |", "| -- | -- |", "| x | y |"].join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].heading).toBeNull();
    expect(chunks[0].text).toContain("intro line");
    expect(chunks[1].heading).toBe("Section A");
    expect(chunks[2].heading).toBe("Section B");
    expect(chunks[2].text).toContain("| x | y |");
  });
});

describe("hybrid retrieval", () => {
  it("ranks the keyword-matching chunk first and respects kb_scope audience filtering", async () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();

    const { ingested } = await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);
    expect(ingested.sort()).toEqual(["doc-a", "doc-b", "doc-c"]);

    const results = await hybridSearch(db, tenant, { audience: ["customer"] }, "skin reaction refund", 5, embeddings);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].article.docId).toBe("doc-a");
    expect(results[0].chunk.heading).toBe("Skin reactions");
    // advisor-only doc-c must never surface to a customer-scoped agent, even though its
    // text ("severe reactions") is a plausible keyword match for this query.
    expect(results.some((r) => r.article.docId === "doc-c")).toBe(false);
  });

  it("re-ingesting unchanged content skips re-embedding", async () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();

    await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);
    const second = await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);

    expect(second.ingested).toEqual([]);
    expect(second.skipped.sort()).toEqual(["doc-a", "doc-b", "doc-c"]);
  });
});
