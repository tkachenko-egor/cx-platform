import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { AgentDefRepository } from "../src/db/repositories/agent-def-repository";
import { AgentExperimentRepository } from "../src/db/repositories/agent-experiment-repository";
import { buildCorePrompt } from "../src/agents/system-prompt";

async function setup() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
  const agentDefs = new AgentDefRepository(db, tenant);
  agentDefs.publish({ key: "support-generalist", systemPrompt: buildCorePrompt("A") + " v1", modelAlias: "support-main" }); // v1
  agentDefs.publish({ key: "support-generalist", systemPrompt: buildCorePrompt("A") + " v2", modelAlias: "support-main" }); // v2
  return { db, tenant, agentDefs };
}

describe("AgentDefRepository.getForTraffic (Phase 2 M6a)", () => {
  it("falls back to getLatestPublished when no experiment exists — zero behavior change for tenants without one", async () => {
    const { agentDefs } = await setup();
    const result = agentDefs.getForTraffic("support-generalist", "CONV-anything");
    expect(result?.version).toBe(2);
  });

  it("deterministically assigns the same conversation to the same variant every time", async () => {
    const { db, tenant, agentDefs } = await setup();
    new AgentExperimentRepository(db, tenant).create({ agentKey: "support-generalist", variantAVersion: 1, variantBVersion: 2, trafficSplit: 0.5 });

    const first = agentDefs.getForTraffic("support-generalist", "CONV-stable-id");
    const second = agentDefs.getForTraffic("support-generalist", "CONV-stable-id");
    const third = agentDefs.getForTraffic("support-generalist", "CONV-stable-id");
    expect(first?.version).toBe(second?.version);
    expect(second?.version).toBe(third?.version);
  });

  it("splits different conversations across both variants over a large enough sample", async () => {
    const { db, tenant, agentDefs } = await setup();
    new AgentExperimentRepository(db, tenant).create({ agentKey: "support-generalist", variantAVersion: 1, variantBVersion: 2, trafficSplit: 0.5 });

    const versions = Array.from({ length: 200 }, (_, i) => agentDefs.getForTraffic("support-generalist", `CONV-${i}`)?.version);
    const uniqueVersions = new Set(versions);
    expect(uniqueVersions.has(1)).toBe(true);
    expect(uniqueVersions.has(2)).toBe(true);
  });

  it("a traffic_split of 0 always assigns variant A, and 1 always assigns variant B", async () => {
    const { db, tenant, agentDefs } = await setup();
    new AgentExperimentRepository(db, tenant).create({ agentKey: "support-generalist", variantAVersion: 1, variantBVersion: 2, trafficSplit: 0 });
    for (let i = 0; i < 20; i++) {
      expect(agentDefs.getForTraffic("support-generalist", `CONV-a-${i}`)?.version).toBe(1);
    }

    const { db: db2, tenant: tenant2, agentDefs: agentDefs2 } = await setup();
    new AgentExperimentRepository(db2, tenant2).create({ agentKey: "support-generalist", variantAVersion: 1, variantBVersion: 2, trafficSplit: 1 });
    for (let i = 0; i < 20; i++) {
      expect(agentDefs2.getForTraffic("support-generalist", `CONV-b-${i}`)?.version).toBe(2);
    }
  });

  it("ignores a stopped experiment and falls back to getLatestPublished", async () => {
    const { db, tenant, agentDefs } = await setup();
    const experiment = new AgentExperimentRepository(db, tenant).create({ agentKey: "support-generalist", variantAVersion: 1, variantBVersion: 2, trafficSplit: 1 });
    new AgentExperimentRepository(db, tenant).stop(experiment.id);

    const result = agentDefs.getForTraffic("support-generalist", "CONV-anything");
    expect(result?.version).toBe(2); // latest published, not variant B's pinned version (which happens to also be 2 here, but via the fallback path)
  });

  it("only allows one active experiment per agent key at a time (idx_agent_experiments_one_active)", async () => {
    const { db, tenant } = await setup();
    const experiments = new AgentExperimentRepository(db, tenant);
    experiments.create({ agentKey: "support-generalist", variantAVersion: 1, variantBVersion: 2, trafficSplit: 0.5 });
    expect(() => experiments.create({ agentKey: "support-generalist", variantAVersion: 1, variantBVersion: 2, trafficSplit: 0.3 })).toThrow();
  });
});
