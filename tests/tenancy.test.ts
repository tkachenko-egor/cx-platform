import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";

describe("tenant scoping", () => {
  it("refuses to construct a tenant-scoped repository without a tenant context", () => {
    const db = createDb(":memory:");
    // @ts-expect-error deliberately omitting the required tenant context
    expect(() => new ModelAliasRepository(db, undefined)).toThrow(/requires a tenant context/);
  });

  it("never returns another tenant's row, even for the same alias name", () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = tenants.create("Tenant A", "tenant-a");
    const tenantB = tenants.create("Tenant B", "tenant-b");

    new ModelAliasRepository(db, tenantA).upsert({ alias: "support-main", provider: "anthropic", model: "claude-sonnet-5" });

    const bView = new ModelAliasRepository(db, tenantB).getByAlias("support-main");
    expect(bView).toBeUndefined();

    const aView = new ModelAliasRepository(db, tenantA).getByAlias("support-main");
    expect(aView?.model).toBe("claude-sonnet-5");
  });
});
