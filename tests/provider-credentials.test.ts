import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { ProviderCredentialRepository } from "../src/db/repositories/provider-credential-repository";
import { encryptSecret, decryptSecret } from "../src/security/credential-crypto";

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

function seededTenant() {
  const db = createDb(":memory:");
  const tenant = new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  const owner = new UserRepository(db, tenant).create({ email: "owner@demo.test", passwordHash: "x", role: "owner" });
  return { db, tenant, owner };
}

describe("credential-crypto", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const secret = "sk-ant-super-secret-value";
    const packed = encryptSecret(secret);
    expect(packed).not.toContain(secret);
    expect(decryptSecret(packed)).toBe(secret);
  });

  it("throws on a tampered ciphertext rather than silently returning garbage", () => {
    const packed = encryptSecret("sk-ant-abc123");
    const parts = packed.split(":");
    parts[3] = Buffer.from("tampered-ciphertext").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});

describe("ProviderCredentialRepository", () => {
  it("setActiveLlmKey replaces the prior active key for the same (tenant, provider)", () => {
    const { db, tenant, owner } = seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);

    const first = credentials.setActiveLlmKey({ provider: "anthropic", label: "First", plaintextKey: "sk-ant-first-key", ownerUserId: owner.id });
    expect(credentials.getActiveLlmKey("anthropic")?.credentialId).toBe(first.id);

    const second = credentials.setActiveLlmKey({ provider: "anthropic", label: "Second", plaintextKey: "sk-ant-second-key", ownerUserId: owner.id });
    const active = credentials.getActiveLlmKey("anthropic");
    expect(active?.credentialId).toBe(second.id);
    expect(active?.decryptedKey).toBe("sk-ant-second-key");

    // The prior row is deactivated, not deleted — still visible in list() as inactive.
    const all = credentials.list();
    expect(all.find((c) => c.id === first.id)?.isActive).toBe(false);
    expect(all).toHaveLength(2);
  });

  it("attributes the active key to whichever user set it", () => {
    const { db, tenant, owner } = seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    credentials.setActiveLlmKey({ provider: "openai", label: "K", plaintextKey: "sk-openai-key", ownerUserId: owner.id });
    expect(credentials.getActiveLlmKey("openai")?.ownerUserId).toBe(owner.id);
  });

  it("list() never returns the decrypted key", () => {
    const { db, tenant, owner } = seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    credentials.setActiveLlmKey({ provider: "anthropic", label: "K", plaintextKey: "sk-ant-should-not-leak", ownerUserId: owner.id });

    const serialized = JSON.stringify(credentials.list());
    expect(serialized).not.toContain("sk-ant-should-not-leak");
    expect(serialized).toContain("keyLast4");
  });

  it("deactivate() takes a key out of getActiveLlmKey without deleting the row", () => {
    const { db, tenant, owner } = seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    const credential = credentials.setActiveLlmKey({ provider: "anthropic", label: "K", plaintextKey: "sk-ant-key", ownerUserId: owner.id });

    credentials.deactivate(credential.id);

    expect(credentials.getActiveLlmKey("anthropic")).toBeUndefined();
    expect(credentials.list()).toHaveLength(1);
  });

  it("tool-integration credentials don't share the one-active-per-provider constraint LLM keys have", () => {
    const { db, tenant, owner } = seededTenant();
    const credentials = new ProviderCredentialRepository(db, tenant);
    const first = credentials.createToolCredential({ provider: "shipping-api", label: "Key A", plaintextKey: "key-a", ownerUserId: owner.id });
    const second = credentials.createToolCredential({ provider: "shipping-api", label: "Key B", plaintextKey: "key-b", ownerUserId: owner.id });

    expect(credentials.getToolCredential(first.id)?.decryptedKey).toBe("key-a");
    expect(credentials.getToolCredential(second.id)?.decryptedKey).toBe("key-b");
  });
});
