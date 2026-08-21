import type Database from "better-sqlite3";

/**
 * `schema.sql` (loaded via CREATE TABLE IF NOT EXISTS) already reflects the
 * current final shape, so a fresh DB — every test's `:memory:` instance, or
 * a brand-new deployment — never needs a migration to run its body: each
 * migration checks the current shape first and no-ops if it's already
 * correct. Migrations only do real work against a pre-existing dev/prod
 * database file created before the schema changed.
 */
export interface Migration {
  id: string;
  up(db: Database.Database): void;
}

export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set((db.prepare(`SELECT id FROM schema_migrations`).all() as { id: string }[]).map((r) => r.id));

  const applyOne = db.transaction((migration: Migration) => {
    migration.up(db);
    db.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(migration.id, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    applyOne(migration);
  }
}
