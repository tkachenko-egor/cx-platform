import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { SessionRepository } from "../src/db/repositories/session-repository";
import { findPlatformAdminUserByEmail, findPlatformAdminSessionByTokenHash } from "../src/auth/platform-admin-lookup";

describe("platform-admin cross-tenant lookup", () => {
  it("finds a platform-admin-flagged user by email without knowing their tenant", () => {
    const db = createDb(":memory:");
    const tenantA = new TenantRepository(db).create("Tenant A", "tenant-a");
    const users = new UserRepository(db, tenantA);
    const owner = users.create({ email: "platform-owner@tenant-a.demo", passwordHash: "x", role: "owner" });
    users.setPlatformAdmin(owner.id, true);

    const found = findPlatformAdminUserByEmail(db, "platform-owner@tenant-a.demo");
    expect(found?.user.id).toBe(owner.id);
    expect(found?.tenant.id).toBe(tenantA.id);
  });

  it("a non-flagged user, even with the same email in a different tenant, is excluded from platform-admin resolution", () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = tenants.create("Tenant A", "tenant-a");
    const tenantB = tenants.create("Tenant B", "tenant-b");

    const flagged = new UserRepository(db, tenantA).create({ email: "shared@demo.com", passwordHash: "x", role: "owner" });
    new UserRepository(db, tenantA).setPlatformAdmin(flagged.id, true);
    // Same email, different tenant, NOT flagged — ordinary tenant data, must stay isolated.
    const ordinary = new UserRepository(db, tenantB).create({ email: "shared@demo.com", passwordHash: "y", role: "owner" });

    const found = findPlatformAdminUserByEmail(db, "shared@demo.com");
    expect(found?.user.id).toBe(flagged.id);
    expect(found?.user.id).not.toBe(ordinary.id);

    // The ordinary user still exists as normal tenant data — this isn't a deletion, just excluded from cross-tenant resolution.
    expect(new UserRepository(db, tenantB).getByEmail("shared@demo.com")?.id).toBe(ordinary.id);
  });

  it("resolves a platform-admin session by token hash across tenants, and rejects a non-flagged user's session", () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = tenants.create("Tenant A", "tenant-a");
    const tenantB = tenants.create("Tenant B", "tenant-b");

    const admin = new UserRepository(db, tenantA).create({ email: "admin@tenant-a.demo", passwordHash: "x", role: "owner" });
    new UserRepository(db, tenantA).setPlatformAdmin(admin.id, true);
    const adminTokenHash = createHash("sha256").update("admin-token").digest("hex");
    new SessionRepository(db, tenantA).create({ userId: admin.id, tokenHash: adminTokenHash, expiresAt: new Date(Date.now() + 60_000).toISOString() });

    const ordinary = new UserRepository(db, tenantB).create({ email: "agent@tenant-b.demo", passwordHash: "x", role: "agent" });
    const ordinaryTokenHash = createHash("sha256").update("ordinary-token").digest("hex");
    new SessionRepository(db, tenantB).create({ userId: ordinary.id, tokenHash: ordinaryTokenHash, expiresAt: new Date(Date.now() + 60_000).toISOString() });

    const resolvedAdmin = findPlatformAdminSessionByTokenHash(db, adminTokenHash);
    expect(resolvedAdmin?.user.id).toBe(admin.id);
    expect(resolvedAdmin?.tenant.id).toBe(tenantA.id);

    expect(findPlatformAdminSessionByTokenHash(db, ordinaryTokenHash)).toBeUndefined();
  });

  it("rejects an expired platform-admin session", () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
    const admin = new UserRepository(db, tenant).create({ email: "admin@tenant-a.demo", passwordHash: "x", role: "owner" });
    new UserRepository(db, tenant).setPlatformAdmin(admin.id, true);
    const tokenHash = createHash("sha256").update("expired-admin-token").digest("hex");
    new SessionRepository(db, tenant).create({ userId: admin.id, tokenHash, expiresAt: new Date(Date.now() - 60_000).toISOString() });

    expect(findPlatformAdminSessionByTokenHash(db, tokenHash)).toBeUndefined();
  });
});
