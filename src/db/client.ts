import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate";
import { ALL_MIGRATIONS } from "./migrations";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(moduleDir, "schema.sql");
const DEFAULT_DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "cx-platform.db");

/**
 * Creates a fresh, schema-bootstrapped connection. Pass ":memory:" for
 * tests (NFR-9.5 — local dev and tests run with zero cloud dependencies).
 * schema.sql always reflects the current final shape (fresh DBs get it for
 * free); migrations only do real work when upgrading a pre-existing DB file.
 */
export function createDb(location: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(location);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  runMigrations(db, ALL_MIGRATIONS);
  return db;
}

let sharedDb: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!sharedDb) {
    sharedDb = createDb();
  }
  return sharedDb;
}
