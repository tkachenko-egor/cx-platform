import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import { encryptSecret, decryptSecret, last4 } from "../../security/credential-crypto";

export type CredentialKind = "llm_provider" | "tool_integration";

export interface ProviderCredentialMeta {
  id: string;
  tenantId: string;
  kind: CredentialKind;
  provider: string;
  label: string;
  keyLast4: string;
  ownerUserId: string;
  isActive: boolean;
  createdAt: string;
  rotatedAt: string | null;
}

interface ProviderCredentialRow {
  id: string;
  tenant_id: string;
  kind: CredentialKind;
  provider: string;
  label: string;
  encrypted_key: string;
  key_last4: string;
  owner_user_id: string;
  is_active: boolean;
  created_at: string;
  rotated_at: string | null;
}

function rowToMeta(row: ProviderCredentialRow): ProviderCredentialMeta {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    provider: row.provider,
    label: row.label,
    keyLast4: row.key_last4,
    ownerUserId: row.owner_user_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at,
  };
}

/**
 * Phase 3 M7: DB-backed provider API keys, per-tenant, attributed to the
 * staff user who added them. `getActiveLlmKey`/`getToolCredential` are the
 * only methods that ever decrypt — `list()` and every other read is
 * metadata-only, so a decrypted key never reaches the admin UI.
 */
export class ProviderCredentialRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  /** Deactivates any prior active row for (tenant, provider), then inserts the new one as active — "setting a new key" replaces whose key is in effect. */
  async setActiveLlmKey(input: { provider: "anthropic" | "openai"; label: string; plaintextKey: string; ownerUserId: string }): Promise<ProviderCredentialMeta> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.tx(async (q) => {
      await q
        .prepare(`UPDATE provider_credentials SET is_active = false WHERE tenant_id = ? AND kind = 'llm_provider' AND provider = ? AND is_active = true`)
        .run(this.tenantId, input.provider);
      await q
        .prepare(
          `INSERT INTO provider_credentials (id, tenant_id, kind, provider, label, encrypted_key, key_last4, owner_user_id, is_active, created_at, rotated_at)
           VALUES (?, ?, 'llm_provider', ?, ?, ?, ?, ?, true, ?, NULL)`,
        )
        .run(id, this.tenantId, input.provider, input.label, encryptSecret(input.plaintextKey), last4(input.plaintextKey), input.ownerUserId, now);
    });

    const row = await this.db.prepare(`SELECT * FROM provider_credentials WHERE tenant_id = ? AND id = ?`).get<ProviderCredentialRow>(this.tenantId, id);
    return rowToMeta(row!);
  }

  /** buildContext()'s read path — the only place besides credential-crypto.ts that sees plaintext. */
  async getActiveLlmKey(provider: string): Promise<{ decryptedKey: string; ownerUserId: string; credentialId: string } | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM provider_credentials WHERE tenant_id = ? AND kind = 'llm_provider' AND provider = ? AND is_active = true`)
      .get<ProviderCredentialRow>(this.tenantId, provider);
    if (!row) return undefined;
    return { decryptedKey: decryptSecret(row.encrypted_key), ownerUserId: row.owner_user_id, credentialId: row.id };
  }

  /** HTTP-tool integration secrets — independent named credentials, no "one active" constraint. */
  async createToolCredential(input: { provider: string; label: string; plaintextKey: string; ownerUserId: string }): Promise<ProviderCredentialMeta> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO provider_credentials (id, tenant_id, kind, provider, label, encrypted_key, key_last4, owner_user_id, is_active, created_at, rotated_at)
         VALUES (?, ?, 'tool_integration', ?, ?, ?, ?, ?, true, ?, NULL)`,
      )
      .run(id, this.tenantId, input.provider, input.label, encryptSecret(input.plaintextKey), last4(input.plaintextKey), input.ownerUserId, now);
    return { id, tenantId: this.tenantId, kind: "tool_integration", provider: input.provider, label: input.label, keyLast4: last4(input.plaintextKey), ownerUserId: input.ownerUserId, isActive: true, createdAt: now, rotatedAt: null };
  }

  async getToolCredential(id: string): Promise<{ decryptedKey: string } | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM provider_credentials WHERE tenant_id = ? AND id = ? AND kind = 'tool_integration' AND is_active = true`)
      .get<ProviderCredentialRow>(this.tenantId, id);
    if (!row) return undefined;
    return { decryptedKey: decryptSecret(row.encrypted_key) };
  }

  async deactivate(id: string): Promise<void> {
    await this.db.prepare(`UPDATE provider_credentials SET is_active = false, rotated_at = ? WHERE tenant_id = ? AND id = ?`).run(new Date().toISOString(), this.tenantId, id);
  }

  /** Metadata only — never the decrypted key. The only thing the admin UI ever sees. */
  async list(): Promise<ProviderCredentialMeta[]> {
    const rows = await this.db.prepare(`SELECT * FROM provider_credentials WHERE tenant_id = ? ORDER BY created_at DESC`).all<ProviderCredentialRow>(this.tenantId);
    return rows.map(rowToMeta);
  }
}
