import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const FORMAT_VERSION = "v1";

/**
 * Master key for encrypting provider API keys at rest (distinct from
 * sessions/invites/password-resets, which only ever store a hash — those
 * are bearer secrets verified by re-hashing, never read back in plaintext.
 * A provider API key must be recoverable to call the provider, so it needs
 * real reversible encryption instead). Read lazily so a zero-config
 * `npm run dev` with no DB-stored credential never crashes for its absence.
 */
function loadMasterKey(): Buffer {
  const encoded = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set — required to store or read a provider credential. Generate one with `openssl rand -base64 32`.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).");
  }
  return key;
}

/** AES-256-GCM encrypt; returns "v1:<ivB64>:<authTagB64>:<ciphertextB64>", self-contained for decryptSecret. */
export function encryptSecret(plaintext: string): string {
  const key = loadMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(packed: string): string {
  const parts = packed.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unrecognized encrypted-credential format");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  const key = loadMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Display-only metadata, e.g. "sk-ant-...wxyz" — never enough to reconstruct the key. */
export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}
