import type { BootstrapContext, SqlExecutor } from "./pg";

/**
 * B1: after the SQLite→Postgres squash there is exactly one migration
 * (`000-baseline`) that emits the full schema. Future schema changes append
 * `001-*`, `002-*`, … each guarded by its own existence check (Postgres
 * `information_schema` / `IF NOT EXISTS`), tracked in `schema_migrations`, and
 * run inside one transaction.
 */
export interface Migration {
  id: string;
  up(db: SqlExecutor): Promise<void>;
}

export async function runMigrations(db: BootstrapContext, migrations: Migration[]): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const rows = await db.prepare(`SELECT id FROM schema_migrations`).all<{ id: string }>();
  const applied = new Set(rows.map((r) => r.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await db.tx(async (q) => {
      await migration.up(q);
      await q.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(migration.id, new Date().toISOString());
    });
  }
}
