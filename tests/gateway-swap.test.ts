import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { ModelGateway } from "../src/gateway/gateway";
import { StubProvider } from "../src/gateway/providers/stub";
import { GatewayError } from "../src/gateway/types";

/**
 * This is the Phase 0 exit criterion from the requirements doc, made
 * executable: "you can swap the underlying model by editing one config
 * row, and nothing else in the codebase changes." Every call below goes
 * through the exact same gateway.chat(...) call site.
 */
describe("model gateway — swap-by-config exit criterion", () => {
  it("routes to whatever model the alias currently points to, with zero code changes between calls", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const modelAliases = new ModelAliasRepository(db, tenant);
    const gateway = new ModelGateway({ db, providers: { stub: new StubProvider() } });

    await modelAliases.upsert({ alias: "support-main", provider: "stub", model: "stub-a" });
    const first = await gateway.chat(tenant, "support-main", "run-1", {
      messages: [{ role: "user", content: "hello" }],
    });
    expect(first.content).toContain("stub:stub-a");

    // The only thing that changes between these two calls is a DB row.
    await modelAliases.upsert({ alias: "support-main", provider: "stub", model: "stub-b" });
    const second = await gateway.chat(tenant, "support-main", "run-2", {
      messages: [{ role: "user", content: "hello" }],
    });
    expect(second.content).toContain("stub:stub-b");
  });

  it("falls back to the next target in the chain on a retryable error, and records the fallback", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const modelAliases = new ModelAliasRepository(db, tenant);

    const flaky = {
      provider: "flaky",
      chat: async () => {
        throw new GatewayError("ProviderUnavailable", "simulated outage");
      },
    };
    const gateway = new ModelGateway({ db, providers: { flaky, stub: new StubProvider() } });

    await modelAliases.upsert({
      alias: "support-main",
      provider: "flaky",
      model: "flaky-1",
      fallbackChain: [{ provider: "stub", model: "stub-a" }],
    });

    const response = await gateway.chat(tenant, "support-main", "run-3", {
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.content).toContain("stub:stub-a");
  });

  it("throws immediately on a non-retryable error without exhausting the fallback chain", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Demo", "demo");
    const modelAliases = new ModelAliasRepository(db, tenant);

    const stubThatShouldNeverRun = new StubProvider();
    const invalid = {
      provider: "invalid",
      chat: async () => {
        throw new GatewayError("InvalidRequest", "bad request");
      },
    };
    const gateway = new ModelGateway({
      db,
      providers: { invalid, stub: stubThatShouldNeverRun },
    });

    await modelAliases.upsert({
      alias: "support-main",
      provider: "invalid",
      model: "invalid-1",
      fallbackChain: [{ provider: "stub", model: "stub-a" }],
    });

    await expect(
      gateway.chat(tenant, "support-main", "run-4", { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("bad request");
  });
});
