import "dotenv/config";
import { buildTemplateDatabase, dropTestDatabases } from "../db/client";

/**
 * B1: vitest runs this once per test run. It builds `cx_test_template` (schema
 * migrated in) so each `createDb(":memory:")` is a fast `CREATE DATABASE …
 * TEMPLATE` clone instead of a full migrate. Needs a reachable Postgres —
 * `docker compose up -d db` (or a CI service container).
 */
export async function setup(): Promise<void> {
  await buildTemplateDatabase();
}

export async function teardown(): Promise<void> {
  await dropTestDatabases();
}
