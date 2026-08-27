import type { Migration } from "../migrate";
import { migration000Baseline } from "./000-baseline";

/**
 * B1 squashed the SQLite schema + 30 incremental migrations into a single
 * Postgres baseline. New schema changes append `001-*`, `002-*`, … here, each
 * idempotent (guard on `information_schema` / `IF NOT EXISTS`) and tracked in
 * `schema_migrations` (see migrate.ts).
 */
export const ALL_MIGRATIONS: Migration[] = [migration000Baseline];
