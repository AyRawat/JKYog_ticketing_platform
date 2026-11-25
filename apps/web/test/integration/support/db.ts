import { createDb, type Database } from "@ticketing/db";
import { reseedTestDatabase } from "@ticketing/db/testing";
import { inject } from "vitest";

const url = inject("testDatabaseUrl");

/** A separate connection for arranging and checking data; the route uses its own pool. */
export const testDb: Database = createDb(url, { maxConnections: 2 });

/** Puts the data back to the seed after a test that changed it. */
export const reseed = (): Promise<void> => reseedTestDatabase(url);
