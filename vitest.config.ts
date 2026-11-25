import { defineConfig } from "vitest/config";

// One config, several projects. `pnpm test` runs the fast, DB-free unit tier.
// An "integration" project (real Postgres) is added alongside the API work.
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
    ],
  },
});
