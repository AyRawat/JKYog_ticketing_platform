import { runMigrations, withClient } from "./lib";

await withClient(runMigrations);
