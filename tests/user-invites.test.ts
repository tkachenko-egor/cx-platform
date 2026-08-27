import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { UserInviteRepository } from "../src/db/repositories/user-invite-repository";
import { hashToken } from "../src/auth/token-hash";

describe("UserInviteRepository", () => {
  it("creates a pending invite without touching the users table", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
    const invites = new UserInviteRepository(db, tenant);

    const invite = await invites.create({ email: "new-agent@tenant-a.demo", role: "agent", tokenHash: hashToken("raw-token"), invitedBy: null, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(invite.acceptedAt).toBeNull();
    expect(await new UserRepository(db, tenant).getByEmail("new-agent@tenant-a.demo")).toBeUndefined();
  });

  it("finds an invite by its token hash and lists only pending invites", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
    const invites = new UserInviteRepository(db, tenant);

    const invite = await invites.create({ email: "a@tenant-a.demo", role: "agent", tokenHash: hashToken("token-a"), invitedBy: null, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await invites.create({ email: "b@tenant-a.demo", role: "viewer", tokenHash: hashToken("token-b"), invitedBy: null, expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect((await invites.getByTokenHash(hashToken("token-a")))?.id).toBe(invite.id);
    expect(await invites.listPending()).toHaveLength(2);

    await invites.markAccepted(invite.id);
    const pending = await invites.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].email).toBe("b@tenant-a.demo");
  });

  it("never returns another tenant's invite by token hash", async () => {
    const db = createDb(":memory:");
    const tenants = new TenantRepository(db);
    const tenantA = await tenants.create("Tenant A", "tenant-a");
    const tenantB = await tenants.create("Tenant B", "tenant-b");

    await new UserInviteRepository(db, tenantA).create({ email: "shared@demo.com", role: "agent", tokenHash: hashToken("shared-token"), invitedBy: null, expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(await new UserInviteRepository(db, tenantB).getByTokenHash(hashToken("shared-token"))).toBeUndefined();
  });
});
