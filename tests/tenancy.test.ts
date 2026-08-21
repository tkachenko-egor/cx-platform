import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { SessionRepository } from "../src/db/repositories/session-repository";

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

  it("NFR-4.5: a second tenant cannot read another tenant's staff user, even by the same email", () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = tenants.create("Tenant A", "tenant-a");
    const tenantB = tenants.create("Tenant B", "tenant-b");

    new UserRepository(db, tenantA).create({ email: "owner@shared-address.demo", passwordHash: "hash-a", role: "owner" });

    expect(new UserRepository(db, tenantB).getByEmail("owner@shared-address.demo")).toBeUndefined();
    expect(new UserRepository(db, tenantA).getByEmail("owner@shared-address.demo")?.passwordHash).toBe("hash-a");
  });

  it("NFR-4.5: a second tenant cannot resolve another tenant's session by token hash", () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = tenants.create("Tenant A", "tenant-a");
    const tenantB = tenants.create("Tenant B", "tenant-b");

    const userA = new UserRepository(db, tenantA).create({ email: "agent@tenant-a.demo", passwordHash: "x", role: "agent" });
    new SessionRepository(db, tenantA).create({ userId: userA.id, tokenHash: "shared-token-hash", expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(new SessionRepository(db, tenantB).getByTokenHash("shared-token-hash")).toBeUndefined();
    expect(new SessionRepository(db, tenantA).getByTokenHash("shared-token-hash")?.userId).toBe(userA.id);
  });
});
