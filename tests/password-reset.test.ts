import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { PasswordResetRepository } from "../src/db/repositories/password-reset-repository";
import { hashToken } from "../src/auth/token-hash";

describe("PasswordResetRepository", () => {
  it("creates, finds, and marks a reset token used", () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
    const user = new UserRepository(db, tenant).create({ email: "owner@tenant-a.demo", passwordHash: "x", role: "owner" });
    const resets = new PasswordResetRepository(db, tenant);

    const reset = resets.create({ userId: user.id, tokenHash: hashToken("raw-token"), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(reset.usedAt).toBeNull();
    expect(resets.getByTokenHash(hashToken("raw-token"))?.id).toBe(reset.id);

    resets.markUsed(reset.id);
    expect(resets.getByTokenHash(hashToken("raw-token"))?.usedAt).not.toBeNull();
  });

  it("never returns another tenant's reset token by hash", () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = tenants.create("Tenant A", "tenant-a");
    const tenantB = tenants.create("Tenant B", "tenant-b");
    const userA = new UserRepository(db, tenantA).create({ email: "a@tenant-a.demo", passwordHash: "x", role: "owner" });

    new PasswordResetRepository(db, tenantA).create({ userId: userA.id, tokenHash: hashToken("shared-token"), expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(new PasswordResetRepository(db, tenantB).getByTokenHash(hashToken("shared-token"))).toBeUndefined();
  });
});

describe("UserRepository.setPasswordHash", () => {
  it("updates the password hash, tenant-scoped", () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
    const users = new UserRepository(db, tenant);
    const user = users.create({ email: "owner@tenant-a.demo", passwordHash: "old-hash", role: "owner" });

    users.setPasswordHash(user.id, "new-hash");
    expect(users.get(user.id)?.passwordHash).toBe("new-hash");
  });
});
