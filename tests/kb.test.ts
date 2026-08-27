import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { KbRetrievalLogRepository } from "../src/db/repositories/kb-retrieval-log-repository";
import { chunkMarkdown } from "../src/kb/chunking";
import { extractPdfText } from "../src/kb/pdf-extract";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { hybridSearch } from "../src/kb/retrieval";
import type { RerankProvider } from "../src/gateway/rerank/types";
import { StubRerankProvider } from "../src/gateway/rerank/stub";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { runAgentTurn } from "../src/agents/runtime";
import { getCoverageGaps } from "../src/analytics/coverage";

beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

class ScriptedProvider implements ProviderAdapter {
  readonly provider = "scripted";
  private calls = 0;
  constructor(private readonly script: ChatResponse[]) {}
  async chat(): Promise<ChatResponse> {
    return this.next();
  }
  async chatStream(_model: string, _request: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse> {
    const response = this.next();
    if (response.content) onDelta(response.content);
    return response;
  }
  private next(): ChatResponse {
    const response = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    return response;
  }
}

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "knowledge");
const FIXTURE_PDF = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "returns-policy.pdf");

describe("chunkMarkdown", () => {
  it("splits on H2 headings and keeps a table intact within one chunk", async () => {
    const body = ["# Title", "intro line", "", "## Section A", "a1", "a2", "", "## Section B", "| h1 | h2 |", "| -- | -- |", "| x | y |"].join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].heading).toBeNull();
    expect(chunks[0].headingLevel).toBeNull();
    expect(chunks[0].text).toContain("intro line");
    expect(chunks[1].heading).toBe("Section A");
    expect(chunks[1].headingLevel).toBe(2);
    expect(chunks[2].heading).toBe("Section B");
    expect(chunks[2].text).toContain("| x | y |");
  });

  it("A5: flags a chunk that contains a Markdown table and never splits the table from its heading", async () => {
    const body = ["## Fees", "Here are the fees.", "", "| State | Fee |", "| -- | -- |", "| Unopened | None |", "| Opened | 15% |"].join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe("Fees");
    expect(chunks[0].containsTable).toBe(true);
    expect(chunks[0].text).toContain("| Unopened | None |");
    expect(chunks[0].text).toContain("| Opened | 15% |");
  });

  it("A5: splits on deeper (H3+) section headings from a layout-aware extractor", async () => {
    const body = ["## Returns", "Overview.", "", "### Unopened items", "Refunded in full.", "", "### Opened items", "Store credit only."].join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks.map((c) => c.heading)).toEqual(["Returns", "Unopened items", "Opened items"]);
    expect(chunks.map((c) => c.headingLevel)).toEqual([2, 3, 3]);
  });
});

describe("extractPdfText", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.DOCLING_URL;
  });

  it("falls back to pdf-parse text-layer extraction when no Docling sidecar is configured", async () => {
    const text = await extractPdfText(fs.readFileSync(FIXTURE_PDF));
    expect(text).toContain("Returns and Refunds");
    expect(text).toContain("30 days");
    expect(text).toContain("Restocking fee");
  });

  it("A5: uses Docling's layout-aware Markdown when DOCLING_URL is set, and the chunker then sees real headings and tables", async () => {
    const doclingMarkdown = [
      "# Returns and Refunds",
      "",
      "## Standard return window",
      "You may return items within 30 days of delivery.",
      "",
      "## Fees by item state",
      "",
      "| State | Window | Restocking fee |",
      "| --- | --- | --- |",
      "| Unopened | 30 days | None |",
      "| Opened | 14 days | 15 percent |",
    ].join("\n");
    process.env.DOCLING_URL = "http://docling.local/convert";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ document: { md_content: doclingMarkdown } }) }),
    );

    const text = await extractPdfText(fs.readFileSync(FIXTURE_PDF));
    expect(text).toBe(doclingMarkdown);

    const chunks = chunkMarkdown(text);
    expect(chunks.map((c) => c.heading)).toEqual([null, "Standard return window", "Fees by item state"]);
    const feesChunk = chunks.find((c) => c.heading === "Fees by item state")!;
    expect(feesChunk.containsTable).toBe(true);
    expect(feesChunk.text).toContain("| Unopened | 30 days | None |");
  });

  it("A5: falls back to pdf-parse (not a throw) when the Docling sidecar is unreachable", async () => {
    process.env.DOCLING_URL = "http://docling.local/convert";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const text = await extractPdfText(fs.readFileSync(FIXTURE_PDF));
    expect(text).toContain("Returns and Refunds");
  });
});

describe("hybrid retrieval", () => {
  it("ranks the keyword-matching chunk first and respects kb_scope audience filtering", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
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

  it("A1: the rerank stage reorders a candidate set where RRF alone puts the right chunk second", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();
    await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);

    const query = "skin reaction refund";
    const baseline = await hybridSearch(db, tenant, { audience: ["customer"] }, query, 4, embeddings);
    expect(baseline.length).toBeGreaterThanOrEqual(2);

    const secondText = baseline[1].chunk.text;
    let sawRan: boolean | undefined;
    const promoteSecond: RerankProvider = {
      provider: "test",
      model: "test",
      async rerank(_q, docs) {
        return docs.map((d) => (d === secondText ? 1 : 0));
      },
    };

    const reranked = await hybridSearch(db, tenant, { audience: ["customer"], rerank: { enabled: true } }, query, 2, embeddings, {
      reranker: promoteSecond,
      onRerankRan: (ran) => {
        sawRan = ran;
      },
    });

    expect(sawRan).toBe(true);
    expect(reranked[0].chunk.id).toBe(baseline[1].chunk.id);
    expect(reranked[0].chunk.id).not.toBe(baseline[0].chunk.id);
    // RRF score scale is preserved on the result even after reordering.
    expect(reranked[0].score).toBeGreaterThan(0);
  });

  it("A1: a failing or absent reranker returns the un-reranked RRF order rather than throwing", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();
    await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);

    const query = "returns and refunds";
    const baseline = await hybridSearch(db, tenant, { audience: ["customer"] }, query, 3, embeddings);

    const throwing: RerankProvider = {
      provider: "test",
      model: "test",
      async rerank() {
        throw new Error("sidecar down");
      },
    };
    let sawRan: boolean | undefined;
    const degraded = await hybridSearch(db, tenant, { audience: ["customer"], rerank: { enabled: true } }, query, 3, embeddings, {
      reranker: throwing,
      onRerankRan: (ran) => {
        sawRan = ran;
      },
    });
    expect(sawRan).toBe(false);
    expect(degraded.map((r) => r.chunk.id)).toEqual(baseline.map((r) => r.chunk.id));

    // A provider present but the agent not opted in (rerank absent) is also a no-op.
    const notOptedIn = await hybridSearch(db, tenant, { audience: ["customer"] }, query, 3, embeddings, { reranker: new StubRerankProvider() });
    expect(notOptedIn.map((r) => r.chunk.id)).toEqual(baseline.map((r) => r.chunk.id));
  });

  it("re-ingesting unchanged content skips re-embedding", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();

    await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);
    const second = await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);

    expect(second.ingested).toEqual([]);
    expect(second.skipped.sort()).toEqual(["doc-a", "doc-b", "doc-c"]);
  });
});

describe("coverage-gap reporting (Phase 2 M3a)", () => {
  it("logs every retrieval's fused score to kb_retrieval_log, independent of what happens afterward", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();
    await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);

    await new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
    const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider([{ content: "Here's what I found.", toolCalls: [], stopReason: "end_turn", usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 } }]) } });
    const agent = await new AgentDefRepository(db, tenant).publish({
      key: "support-generalist",
      systemPrompt: buildCorePrompt("Demo"),
      modelAlias: "support-main",
      kbScope: { audience: ["customer"] },
    });

    await runAgentTurn({ db, gateway, embeddings }, tenant, "CONV-1", "run-1", agent, [], "returns and refunds");

    const logged = new KbRetrievalLogRepository(db, tenant).listLowConfidence(1); // 1 is above any real RRF score, so this returns everything
    expect(logged).toHaveLength(1);
    expect(logged[0].queryText).toBe("returns and refunds");
    expect(logged[0].bestScore).toBeGreaterThan(0);
    expect(logged[0].retrievedDocIds).toContain("doc-a");
  });

  it("getCoverageGaps surfaces only retrievals below the confidence threshold", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const repo = new KbRetrievalLogRepository(db, tenant);
    repo.record({ conversationId: "CONV-1", runId: "run-1", queryText: "a well-matched question", bestScore: 0.05, retrievedDocIds: ["doc-a"] });
    repo.record({ conversationId: "CONV-1", runId: "run-2", queryText: "a poorly-matched question", bestScore: 0.0, retrievedDocIds: [] });

    const gaps = getCoverageGaps(db, tenant, { thresholdScore: 0.01 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].queryText).toBe("a poorly-matched question");
  });

  it("A1: kb_retrieval_log persists whether the rerank stage ran", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const repo = new KbRetrievalLogRepository(db, tenant);
    repo.record({ conversationId: "CONV-1", runId: "run-1", queryText: "with rerank", bestScore: 0.5, retrievedDocIds: ["doc-a"], reranked: true });
    repo.record({ conversationId: "CONV-1", runId: "run-2", queryText: "without rerank", bestScore: 0.5, retrievedDocIds: ["doc-a"] });

    const byQuery = new Map(repo.listLowConfidence(1).map((e) => [e.queryText, e.reranked]));
    expect(byQuery.get("with rerank")).toBe(true);
    expect(byQuery.get("without rerank")).toBe(false);
  });
});

describe("StubRerankProvider", () => {
  it("scores by query-token overlap, deterministically", async () => {
    const stub = new StubRerankProvider();
    const scores = await stub.rerank("full refund policy", ["a full refund is available", "orders ship in two days", "refund"]);
    expect(scores).toEqual(await stub.rerank("full refund policy", ["a full refund is available", "orders ship in two days", "refund"]));
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[0]).toBeGreaterThan(scores[2]);
  });
});
