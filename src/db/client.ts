import { randomUUID } from "node:crypto";
import { runMigrations } from "./migrate";
import { ALL_MIGRATIONS } from "./migrations";
import { pg, SqlDatabase } from "./pg";

const DEFAULT_URL = "postgres://cx:cx@localhost:5432/cx_platform";
const PROD_URL = process.env.DATABASE_URL ?? DEFAULT_URL;

/** Admin/maintenance connection the test harness clones per-suite databases from. */
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://cx:cx@localhost:5432/postgres";
export const TEMPLATE_DB = "cx_test_template";

function withDbName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * B1: `createDb()` builds a Postgres-backed handle. `":memory:"` (every test's
 * fresh-DB call) clones a disposable database from the migrated template built
 * once by `src/testing/global-setup.ts` — the closest Postgres analogue to the
 * old in-memory SQLite instance. Any other value connects to `DATABASE_URL`
 * and runs migrations. The call stays synchronous; the handle defers its first
 * query until the clone / migration finishes.
 */
export function createDb(location?: string): SqlDatabase {
  if (location === ":memory:") return createEphemeralDb();

  const pool = new pg.Pool({ connectionString: PROD_URL });
  return new SqlDatabase(pool).bootstrap((ctx) => runMigrations(ctx, ALL_MIGRATIONS));
}

function createEphemeralDb(): SqlDatabase {
  const name = `cx_test_${randomUUID().replace(/-/g, "")}`;
  const pool = new pg.Pool({ connectionString: withDbName(ADMIN_URL, name), max: 3, idleTimeoutMillis: 2000, connectionTimeoutMillis: 15000 });
  return new SqlDatabase(pool).bootstrap(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE ${TEMPLATE_DB}`);
    } finally {
      await admin.end();
    }
  });
}

/** Builds the migrated template database the test suites clone from. */
export async function buildTemplateDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname LIKE 'cx_test_%' AND pid <> pg_backend_pid()`,
    );
    const stale = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'cx_test_%'`,
    );
    for (const row of stale.rows) await admin.query(`DROP DATABASE IF EXISTS "${row.datname}"`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: withDbName(ADMIN_URL, TEMPLATE_DB) });
  const db = new SqlDatabase(pool).bootstrap((ctx) => runMigrations(ctx, ALL_MIGRATIONS));
  await db.exec("SELECT 1"); // force the bootstrap to complete
  await db.close();
}

/** Drops every database the test suites created, including the template. */
export async function dropTestDatabases(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname LIKE 'cx_test_%' AND pid <> pg_backend_pid()`,
    );
    const rows = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'cx_test_%'`,
    );
    for (const row of rows.rows) await admin.query(`DROP DATABASE IF EXISTS "${row.datname}"`);
  } finally {
    await admin.end();
  }
}

let sharedDb: SqlDatabase | undefined;

export function getDb(): SqlDatabase {
  if (!sharedDb) {
    sharedDb = createDb();
  }
  return sharedDb;
}
