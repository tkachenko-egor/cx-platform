import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { PasswordResetRepository } from "../src/db/repositories/password-reset-repository";
import { hashToken } from "../src/auth/token-hash";

describe("PasswordResetRepository", () => {
  it("creates, finds, and marks a reset token used", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
    const user = await new UserRepository(db, tenant).create({ email: "owner@tenant-a.demo", passwordHash: "x", role: "owner" });
    const resets = new PasswordResetRepository(db, tenant);

    const reset = await resets.create({ userId: user.id, tokenHash: hashToken("raw-token"), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(reset.usedAt).toBeNull();
    expect((await resets.getByTokenHash(hashToken("raw-token")))?.id).toBe(reset.id);

    await resets.markUsed(reset.id);
    expect((await resets.getByTokenHash(hashToken("raw-token")))?.usedAt).not.toBeNull();
  });

  it("never returns another tenant's reset token by hash", async () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = await tenants.create("Tenant A", "tenant-a");
    const tenantB = await tenants.create("Tenant B", "tenant-b");
    const userA = await new UserRepository(db, tenantA).create({ email: "a@tenant-a.demo", passwordHash: "x", role: "owner" });

    await new PasswordResetRepository(db, tenantA).create({ userId: userA.id, tokenHash: hashToken("shared-token"), expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(await new PasswordResetRepository(db, tenantB).getByTokenHash(hashToken("shared-token"))).toBeUndefined();
  });
});

describe("UserRepository.setPasswordHash", () => {
  it("updates the password hash, tenant-scoped", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
    const users = new UserRepository(db, tenant);
    const user = await users.create({ email: "owner@tenant-a.demo", passwordHash: "old-hash", role: "owner" });

    await users.setPasswordHash(user.id, "new-hash");
    expect((await users.get(user.id))?.passwordHash).toBe("new-hash");
  });
});
