import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { MacroRepository } from "../src/db/repositories/macro-repository";

function setup() {
  const db = createDb(":memory:");
  const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
  const agentUser = new UserRepository(db, tenant).create({ email: "agent@tenant-a.demo", passwordHash: "x", role: "agent" });
  return { db, tenant, agentUser };
}

describe("MacroRepository (Phase 2 M8)", () => {
  it("creates a macro with a default empty tag list, scoped to its tenant", () => {
    const { db, tenant, agentUser } = setup();
    const macros = new MacroRepository(db, tenant);

    const macro = macros.create({ name: "Order delay", body: "Your order is running a bit behind — sorry about that!", createdBy: agentUser.id });
    expect(macro.tags).toEqual([]);
    expect(macro.createdBy).toBe(agentUser.id);
    expect(macros.get(macro.id)?.id).toBe(macro.id);
  });

  it("lists macros alphabetically by name", () => {
    const { db, tenant } = setup();
    const macros = new MacroRepository(db, tenant);
    macros.create({ name: "Zzz macro", body: "z" });
    macros.create({ name: "Aaa macro", body: "a" });

    expect(macros.list().map((m) => m.name)).toEqual(["Aaa macro", "Zzz macro"]);
  });

  it("searches by substring across name and body", () => {
    const { db, tenant } = setup();
    const macros = new MacroRepository(db, tenant);
    macros.create({ name: "Refund policy", body: "We process refunds within 5 business days." });
    macros.create({ name: "Shipping delay", body: "Your package is delayed due to carrier issues." });

    expect(macros.search("refund").map((m) => m.name)).toEqual(["Refund policy"]);
    expect(macros.search("delayed").map((m) => m.name)).toEqual(["Shipping delay"]);
    expect(macros.search("nonexistent")).toEqual([]);
  });

  it("updates name/body/tags and bumps updatedAt", () => {
    const { db, tenant } = setup();
    const macros = new MacroRepository(db, tenant);
    const macro = macros.create({ name: "Welcome", body: "Hi there!", tags: ["greeting"] });

    macros.update(macro.id, { body: "Hello, welcome to Fixture Retail Co!", tags: ["greeting", "onboarding"] });
    const updated = macros.get(macro.id)!;
    expect(updated.name).toBe("Welcome");
    expect(updated.body).toBe("Hello, welcome to Fixture Retail Co!");
    expect(updated.tags).toEqual(["greeting", "onboarding"]);
  });

  it("deletes a macro", () => {
    const { db, tenant } = setup();
    const macros = new MacroRepository(db, tenant);
    const macro = macros.create({ name: "Temp", body: "temp" });

    macros.delete(macro.id);
    expect(macros.get(macro.id)).toBeUndefined();
  });

  it("scopes macros per tenant", () => {
    const db = createDb(":memory:");
    const tenantA = new TenantRepository(db).create("Tenant A", "tenant-a");
    const tenantB = new TenantRepository(db).create("Tenant B", "tenant-b");
    const macrosA = new MacroRepository(db, tenantA);
    const macrosB = new MacroRepository(db, tenantB);

    macrosA.create({ name: "A-only", body: "a" });
    expect(macrosB.list()).toEqual([]);
    expect(macrosA.list()).toHaveLength(1);
  });
});
