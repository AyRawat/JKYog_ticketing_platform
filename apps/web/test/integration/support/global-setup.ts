import { prepareTestDatabase } from "@ticketing/db/testing";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/** Runs once per test run: a fresh schema from the migrations, plus the seed data. */
export default async function setup(project: TestProject): Promise<void> {
  const url = project.config.provide.testDatabaseUrl;
  if (!url) throw new Error("testDatabaseUrl is not provided; see vitest.config.ts");
  await prepareTestDatabase(url);
}
