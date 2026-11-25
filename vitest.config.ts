import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run the real route handlers against a real Postgres. The database must be
// local and named *_test; it is rebuilt from migrations and seeds before every run.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/sharad_utsav_test";

const web = (relative: string) => path.resolve(import.meta.dirname, "apps/web", relative);

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: {
          alias: {
            "@": web("src"),
            // Next swaps this guard for an empty module on the server; do the same here.
            "server-only": web("test/integration/support/server-only.ts"),
          },
        },
        test: {
          name: "integration",
          include: ["apps/web/test/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: [web("test/integration/support/global-setup.ts")],
          // The app reads DATABASE_URL; point it (and nothing else) at the test database.
          env: { DATABASE_URL: TEST_DATABASE_URL },
          provide: { testDatabaseUrl: TEST_DATABASE_URL },
          // Files share one database, so run them one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
