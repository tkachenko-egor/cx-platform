import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { MacroRepository } from "../src/db/repositories/macro-repository";

async function setup() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
  const agentUser = await new UserRepository(db, tenant).create({ email: "agent@tenant-a.demo", passwordHash: "x", role: "agent" });
  return { db, tenant, agentUser };
}

describe("MacroRepository (Phase 2 M8)", () => {
  it("creates a macro with a default empty tag list, scoped to its tenant", async () => {
    const { db, tenant, agentUser } = await setup();
    const macros = new MacroRepository(db, tenant);

    const macro = await macros.create({ name: "Order delay", body: "Your order is running a bit behind — sorry about that!", createdBy: agentUser.id });
    expect(macro.tags).toEqual([]);
    expect(macro.createdBy).toBe(agentUser.id);
    expect((await macros.get(macro.id))?.id).toBe(macro.id);
  });

  it("lists macros alphabetically by name", async () => {
    const { db, tenant } = await setup();
    const macros = new MacroRepository(db, tenant);
    await macros.create({ name: "Zzz macro", body: "z" });
    await macros.create({ name: "Aaa macro", body: "a" });

    expect((await macros.list()).map((m) => m.name)).toEqual(["Aaa macro", "Zzz macro"]);
  });

  it("searches by substring across name and body", async () => {
    const { db, tenant } = await setup();
    const macros = new MacroRepository(db, tenant);
    await macros.create({ name: "Refund policy", body: "We process refunds within 5 business days." });
    await macros.create({ name: "Shipping delay", body: "Your package is delayed due to carrier issues." });

    expect((await macros.search("refund")).map((m) => m.name)).toEqual(["Refund policy"]);
    expect((await macros.search("delayed")).map((m) => m.name)).toEqual(["Shipping delay"]);
    expect(await macros.search("nonexistent")).toEqual([]);
  });

  it("updates name/body/tags and bumps updatedAt", async () => {
    const { db, tenant } = await setup();
    const macros = new MacroRepository(db, tenant);
    const macro = await macros.create({ name: "Welcome", body: "Hi there!", tags: ["greeting"] });

    await macros.update(macro.id, { body: "Hello, welcome to Fixture Retail Co!", tags: ["greeting", "onboarding"] });
    const updated = (await macros.get(macro.id))!;
    expect(updated.name).toBe("Welcome");
    expect(updated.body).toBe("Hello, welcome to Fixture Retail Co!");
    expect(updated.tags).toEqual(["greeting", "onboarding"]);
  });

  it("deletes a macro", async () => {
    const { db, tenant } = await setup();
    const macros = new MacroRepository(db, tenant);
    const macro = await macros.create({ name: "Temp", body: "temp" });

    await macros.delete(macro.id);
    expect(await macros.get(macro.id)).toBeUndefined();
  });

  it("scopes macros per tenant", async () => {
    const db = createDb(":memory:");
    const tenantA = await new TenantRepository(db).create("Tenant A", "tenant-a");
    const tenantB = await new TenantRepository(db).create("Tenant B", "tenant-b");
    const macrosA = new MacroRepository(db, tenantA);
    const macrosB = new MacroRepository(db, tenantB);

    await macrosA.create({ name: "A-only", body: "a" });
    expect(await macrosB.list()).toEqual([]);
    expect(await macrosA.list()).toHaveLength(1);
  });
});
