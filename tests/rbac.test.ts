import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { SessionRepository } from "../src/db/repositories/session-repository";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { can, roleAtLeast } from "../src/auth/permissions";

describe("staff passwords", () => {
  it("hashes and verifies a password without storing it in plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});

describe("permission matrix (FR-2.2)", () => {
  it("only owner/admin can manage users", () => {
    expect(can("owner", "manage_users")).toBe(true);
    expect(can("admin", "manage_users")).toBe(true);
    expect(can("supervisor", "manage_users")).toBe(false);
    expect(can("agent", "manage_users")).toBe(false);
    expect(can("viewer", "manage_users")).toBe(false);
  });

  it("agent and above can reply as human, viewer cannot", () => {
    expect(can("agent", "reply_as_human")).toBe(true);
    expect(can("supervisor", "reply_as_human")).toBe(true);
    expect(can("viewer", "reply_as_human")).toBe(false);
  });

  it("roleAtLeast respects the owner > admin > supervisor > agent > viewer hierarchy", () => {
    expect(roleAtLeast("owner", "agent")).toBe(true);
    expect(roleAtLeast("agent", "owner")).toBe(false);
    expect(roleAtLeast("agent", "agent")).toBe(true);
    expect(roleAtLeast("viewer", "agent")).toBe(false);
  });
});

describe("users and sessions", () => {
  it("creates a staff user scoped to a tenant and finds it by email", async () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
    const users = new UserRepository(db, tenant);

    const created = users.create({ email: "agent@tenant-a.demo", passwordHash: await hashPassword("hunter2"), role: "agent" });
    expect(users.getByEmail("agent@tenant-a.demo")?.id).toBe(created.id);
    expect(users.get(created.id)?.role).toBe("agent");
  });

  it("issues, looks up, and revokes a session by token hash — never storing the raw token", () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
    const users = new UserRepository(db, tenant);
    const user = users.create({ email: "owner@tenant-a.demo", passwordHash: "irrelevant-for-this-test", role: "owner" });

    const sessions = new SessionRepository(db, tenant);
    const rawToken = "test-raw-session-token";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    sessions.create({ userId: user.id, tokenHash, expiresAt });
    expect(sessions.getByTokenHash(tokenHash)?.userId).toBe(user.id);

    sessions.deleteByTokenHash(tokenHash);
    expect(sessions.getByTokenHash(tokenHash)).toBeUndefined();
  });

  it("UserRepository.update() changes role/status but never crosses a tenant boundary", () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = tenants.create("Tenant A", "tenant-a");
    const tenantB = tenants.create("Tenant B", "tenant-b");

    const userA = new UserRepository(db, tenantA).create({ email: "agent@tenant-a.demo", passwordHash: "x", role: "agent" });

    const updated = new UserRepository(db, tenantA).update(userA.id, { role: "supervisor", status: "disabled" });
    expect(updated?.role).toBe("supervisor");
    expect(updated?.status).toBe("disabled");
    expect(new UserRepository(db, tenantA).get(userA.id)?.role).toBe("supervisor");

    // Tenant B can't touch tenant A's user, even by guessing its id.
    expect(new UserRepository(db, tenantB).update(userA.id, { role: "owner" })).toBeUndefined();
    expect(new UserRepository(db, tenantA).get(userA.id)?.role).toBe("supervisor");
  });

  it("a session past its expiry is distinguishable from a live one (the check getSessionUser applies)", () => {
    const db = createDb(":memory:");
    const tenant = new TenantRepository(db).create("Tenant A", "tenant-a");
    const user = new UserRepository(db, tenant).create({ email: "agent@tenant-a.demo", passwordHash: "x", role: "agent" });
    const sessions = new SessionRepository(db, tenant);

    const tokenHash = createHash("sha256").update("expired-token").digest("hex");
    sessions.create({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() - 60_000).toISOString() });

    const session = sessions.getByTokenHash(tokenHash);
    expect(session).toBeDefined();
    expect(session!.expiresAt < new Date().toISOString()).toBe(true);
  });
});
