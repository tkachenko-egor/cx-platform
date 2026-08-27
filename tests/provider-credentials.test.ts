import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { ProviderCredentialRepository } from "../src/db/repositories/provider-credential-repository";
import { encryptSecret, decryptSecret } from "../src/security/credential-crypto";

beforeAll(async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

async function seededTenant() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  const owner = await new UserRepository(db, tenant).create({ email: "owner@demo.test", passwordHash: "x", role: "owner" });
  return { db, tenant, owner };
}

describe("credential-crypto", () => {
  it("round-trips a secret through encrypt/decrypt", async () => {
    const secret = "sk-ant-super-secret-value";
    const packed = encryptSecret(secret);
    expect(packed).not.toContain(secret);
    expect(decryptSecret(packed)).toBe(secret);
  });

  it("throws on a tampered ciphertext rather than silently returning garbage", async () => {
    const packed = encryptSecret("sk-ant-abc123");
    const parts = packed.split(":");
    parts[3] = Buffer.from("tampered-ciphertext").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});

describe("ProviderCredentialRepository", () => {
  it("setActiveLlmKey replaces the prior active key for the same (tenant, provider)", async () => {
    const { db, tenant, owner } = await seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);

    const first = await credentials.setActiveLlmKey({ provider: "anthropic", label: "First", plaintextKey: "sk-ant-first-key", ownerUserId: owner.id });
    expect((await credentials.getActiveLlmKey("anthropic"))?.credentialId).toBe(first.id);

    const second = await credentials.setActiveLlmKey({ provider: "anthropic", label: "Second", plaintextKey: "sk-ant-second-key", ownerUserId: owner.id });
    const active = await credentials.getActiveLlmKey("anthropic");
    expect(active?.credentialId).toBe(second.id);
    expect(active?.decryptedKey).toBe("sk-ant-second-key");

    // The prior row is deactivated, not deleted — still visible in list() as inactive.
    const all = await credentials.list();
    expect(all.find((c) => c.id === first.id)?.isActive).toBe(false);
    expect(all).toHaveLength(2);
  });

  it("attributes the active key to whichever user set it", async () => {
    const { db, tenant, owner } = await seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    await credentials.setActiveLlmKey({ provider: "openai", label: "K", plaintextKey: "sk-openai-key", ownerUserId: owner.id });
    expect((await credentials.getActiveLlmKey("openai"))?.ownerUserId).toBe(owner.id);
  });

  it("list() never returns the decrypted key", async () => {
    const { db, tenant, owner } = await seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    await credentials.setActiveLlmKey({ provider: "anthropic", label: "K", plaintextKey: "sk-ant-should-not-leak", ownerUserId: owner.id });

    const serialized = JSON.stringify(await credentials.list());
    expect(serialized).not.toContain("sk-ant-should-not-leak");
    expect(serialized).toContain("keyLast4");
  });

  it("deactivate() takes a key out of getActiveLlmKey without deleting the row", async () => {
    const { db, tenant, owner } = await seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    const credential = await credentials.setActiveLlmKey({ provider: "anthropic", label: "K", plaintextKey: "sk-ant-key", ownerUserId: owner.id });

    await credentials.deactivate(credential.id);

    expect(await credentials.getActiveLlmKey("anthropic")).toBeUndefined();
    expect(await credentials.list()).toHaveLength(1);
  });

  it("tool-integration credentials don't share the one-active-per-provider constraint LLM keys have", async () => {
    const { db, tenant, owner } = await seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    const first = await credentials.createToolCredential({ provider: "shipping-api", label: "Key A", plaintextKey: "key-a", ownerUserId: owner.id });
    const second = await credentials.createToolCredential({ provider: "shipping-api", label: "Key B", plaintextKey: "key-b", ownerUserId: owner.id });

    expect((await credentials.getToolCredential(first.id))?.decryptedKey).toBe("key-a");
    expect((await credentials.getToolCredential(second.id))?.decryptedKey).toBe("key-b");
  });
});
