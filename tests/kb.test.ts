import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { KbRetrievalLogRepository } from "../src/db/repositories/kb-retrieval-log-repository";
import { chunkMarkdown } from "../src/kb/chunking";
import { ingestKnowledgeBase } from "../src/kb/ingest";
import { hybridSearch } from "../src/kb/retrieval";
import { StubEmbeddingProvider } from "../src/gateway/embeddings/stub";
import { ModelGateway } from "../src/gateway/gateway";
import type { ChatRequest, ChatResponse, ProviderAdapter } from "../src/gateway/types";
import { buildCorePrompt } from "../src/agents/system-prompt";
import { runAgentTurn } from "../src/agents/runtime";
import { getCoverageGaps } from "../src/analytics/coverage";

beforeAll(() => {
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

describe("coverage-gap reporting (Phase 2 M3a)", () => {
  it("logs every retrieval's fused score to kb_retrieval_log, independent of what happens afterward", async () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Demo", "demo");
    const embeddings = new StubEmbeddingProvider();
    await ingestKnowledgeBase(db, tenant, embeddings, FIXTURES_DIR);

    new ModelAliasRepository(db, tenant).upsert({ alias: "support-main", provider: "scripted", model: "scripted-1" });
    const gateway = new ModelGateway({ db, providers: { scripted: new ScriptedProvider([{ content: "Here's what I found.", toolCalls: [], stopReason: "end_turn", usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 } }]) } });
    const agent = new AgentDefRepository(db, tenant).publish({
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
    const tenant = new TenantRepository(db).create("Demo", "demo");
    const repo = new KbRetrievalLogRepository(db, tenant);
    repo.record({ conversationId: "CONV-1", runId: "run-1", queryText: "a well-matched question", bestScore: 0.05, retrievedDocIds: ["doc-a"] });
    repo.record({ conversationId: "CONV-1", runId: "run-2", queryText: "a poorly-matched question", bestScore: 0.0, retrievedDocIds: [] });

    const gaps = getCoverageGaps(db, tenant, { thresholdScore: 0.01 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].queryText).toBe("a poorly-matched question");
  });
});
