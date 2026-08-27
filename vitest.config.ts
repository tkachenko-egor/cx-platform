import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./src/testing/global-setup.ts",
    // B1: every suite clones its own throwaway Postgres database. Bound the
    // fan-out so parallel `CREATE DATABASE … TEMPLATE` calls and pooled
    // connections stay well under a default server's limits.
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 },
    },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
