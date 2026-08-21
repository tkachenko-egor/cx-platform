import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { Tenant } from "../../db/repositories/tenant-repository";
import { ConversationRepository } from "../../db/repositories/conversation-repository";
import { MessageRepository } from "../../db/repositories/message-repository";

const REPLY_PREFIX = /^\s*(re|fwd?|aw)\s*:\s*/i;

/** FR-3.12: normalizes away (possibly repeated, e.g. "Fwd: RE:") Re:/Fwd:/Aw: prefixes and casing so the same thread hashes the same regardless of client mangling. */
export function normalizedSubjectHash(subject: string): string {
  let stripped = subject.trim();
  while (REPLY_PREFIX.test(stripped)) {
    stripped = stripped.replace(REPLY_PREFIX, "");
  }
  const normalized = stripped.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/** FR-3.12: resolve via Message-ID/In-Reply-To/References first, with a subject-hash fallback. */
export function resolveEmailConversationId(
  db: Database.Database,
  tenant: Tenant,
  input: { inReplyToExternalId?: string; references?: string[]; subject: string },
): string | undefined {
  const candidateIds = [input.inReplyToExternalId, ...(input.references ?? [])].filter((id): id is string => Boolean(id));

  if (candidateIds.length > 0) {
    const found = new MessageRepository(db, tenant).findConversationIdByChannelMessageIds(candidateIds);
    if (found) return found;
  }

  const subjectHash = normalizedSubjectHash(input.subject);
  return new ConversationRepository(db, tenant).findBySubjectHash(subjectHash)?.id;
}
