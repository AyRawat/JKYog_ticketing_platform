import { execFileSync } from "node:child_process";
import { requireDatabaseUrl } from "./lib";

// Regenerates src/database.generated.ts from the live schema. Run after every migration.
execFileSync(
  "kysely-codegen",
  [
    "--dialect=postgres",
    `--url=${requireDatabaseUrl()}`,
    "--date-parser=string",
    "--exclude-pattern=schema_migrations",
    "--out-file=src/database.generated.ts",
  ],
  { stdio: "inherit" },
);
