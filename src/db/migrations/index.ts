import type { Migration } from "../migrate";
import { migration000Baseline } from "./000-baseline";
import { migration001PgvectorKbChunksEmbedding } from "./001-pgvector-kb-chunks-embedding";
import { migration002KbChunksFtsPerLanguage } from "./002-kb-chunks-fts-per-language";
import { migration003RowLevelSecurity } from "./003-row-level-security";
import { migration004AgentSessions } from "./004-agent-sessions";

/**
 * B1 squashed the SQLite schema + 30 incremental migrations into a single
 * Postgres baseline. New schema changes append `001-*`, `002-*`, … here, each
 * idempotent (guard on `information_schema` / `IF NOT EXISTS`) and tracked in
 * `schema_migrations` (see migrate.ts).
 */
export const ALL_MIGRATIONS: Migration[] = [
  migration000Baseline,
  migration001PgvectorKbChunksEmbedding,
  migration002KbChunksFtsPerLanguage,
  migration003RowLevelSecurity,
  migration004AgentSessions,
];
