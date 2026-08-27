import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ModelAliasRepository } from "../src/db/repositories/model-alias-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { SessionRepository } from "../src/db/repositories/session-repository";

describe("tenant scoping", () => {
  it("refuses to construct a tenant-scoped repository without a tenant context", async () => {
    const db = createDb(":memory:");
    // @ts-expect-error deliberately omitting the required tenant context
    expect(() => new ModelAliasRepository(db, undefined)).toThrow(/requires a tenant context/);
  });

  it("never returns another tenant's row, even for the same alias name", async () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = await tenants.create("Tenant A", "tenant-a");
    const tenantB = await tenants.create("Tenant B", "tenant-b");

    await new ModelAliasRepository(db, tenantA).upsert({ alias: "support-main", provider: "anthropic", model: "claude-sonnet-5" });

    const bView = await new ModelAliasRepository(db, tenantB).getByAlias("support-main");
    expect(bView).toBeUndefined();

    const aView = await new ModelAliasRepository(db, tenantA).getByAlias("support-main");
    expect(aView?.model).toBe("claude-sonnet-5");
  });

  it("NFR-4.5: a second tenant cannot read another tenant's staff user, even by the same email", async () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = await tenants.create("Tenant A", "tenant-a");
    const tenantB = await tenants.create("Tenant B", "tenant-b");

    await new UserRepository(db, tenantA).create({ email: "owner@shared-address.demo", passwordHash: "hash-a", role: "owner" });

    expect(await new UserRepository(db, tenantB).getByEmail("owner@shared-address.demo")).toBeUndefined();
    expect((await new UserRepository(db, tenantA).getByEmail("owner@shared-address.demo"))?.passwordHash).toBe("hash-a");
  });

  it("NFR-4.5: a second tenant cannot resolve another tenant's session by token hash", async () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = await tenants.create("Tenant A", "tenant-a");
    const tenantB = await tenants.create("Tenant B", "tenant-b");

    const userA = await new UserRepository(db, tenantA).create({ email: "agent@tenant-a.demo", passwordHash: "x", role: "agent" });
    await new SessionRepository(db, tenantA).create({ userId: userA.id, tokenHash: "shared-token-hash", expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(await new SessionRepository(db, tenantB).getByTokenHash("shared-token-hash")).toBeUndefined();
    expect((await new SessionRepository(db, tenantA).getByTokenHash("shared-token-hash"))?.userId).toBe(userA.id);
  });

  it("B5: RLS is a hard backstop — a scoped handle can't cross tenants even with no WHERE clause", async () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = await tenants.create("Tenant A", "tenant-a");
    const tenantB = await tenants.create("Tenant B", "tenant-b");

    await new ModelAliasRepository(db, tenantA).upsert({ alias: "support-main", provider: "anthropic", model: "model-a" });
    await new ModelAliasRepository(db, tenantB).upsert({ alias: "support-main", provider: "anthropic", model: "model-b" });

    // a tenant-B handle running a deliberately unscoped SELECT sees only tenant B
    const bScoped = db.forTenant(tenantB.tenantId);
    const seen = await bScoped.prepare(`SELECT tenant_id, model FROM model_aliases`).all<{ tenant_id: string; model: string }>();
    expect(seen).toEqual([{ tenant_id: tenantB.tenantId, model: "model-b" }]);

    // ...and can't write a row tagged for another tenant (WITH CHECK)
    await expect(
      bScoped
        .prepare(`INSERT INTO model_aliases (id, tenant_id, alias, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run("forced-id", tenantA.tenantId, "x", "anthropic", "m", new Date().toISOString(), new Date().toISOString()),
    ).rejects.toThrow();

    // the unscoped root handle is the documented exemption — seed / platform-admin path still sees everything
    const all = await db.prepare(`SELECT tenant_id FROM model_aliases`).all();
    expect(all).toHaveLength(2);
  });

  it("TenantRepository.list/getById/update support platform-level tenant management", async () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = await tenants.create("Tenant A", "tenant-a");
    await tenants.create("Tenant B", "tenant-b");

    expect((await tenants.list()).map((t) => t.slug).sort()).toEqual(["tenant-a", "tenant-b"]);
    expect((await tenants.getById(tenantA.id))?.slug).toBe("tenant-a");
    expect(await tenants.getById("nonexistent-id")).toBeUndefined();

    const renamed = await tenants.update(tenantA.id, { name: "Tenant A Renamed" });
    expect(renamed.name).toBe("Tenant A Renamed");
    expect(renamed.slug).toBe("tenant-a");
    expect((await tenants.getBySlug("tenant-a"))?.name).toBe("Tenant A Renamed");
  });
});
