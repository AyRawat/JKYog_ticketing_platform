import pg from "pg";
import { runMigrations, runSeeds } from "./lib";

// Helpers for integration tests. Every function refuses to run against anything but a local
// database whose name ends in "_test", so a test run can never touch Neon or the dev database.

const quiet = () => undefined;

export function assertTestDatabase(url: string): void {
  const { hostname, pathname } = new URL(url);
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isLocal || !pathname.endsWith("_test")) {
    throw new Error(
      `Refusing to use '${hostname}${pathname}' for tests: it must be local and end in _test.`,
    );
  }
}

async function withClient(url: string, fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

/** Creates the database if needed, then rebuilds the schema from migrations and seeds it. */
export async function prepareTestDatabase(url: string): Promise<void> {
  assertTestDatabase(url);
  const name = new URL(url).pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  await withClient(admin.toString(), async (client) => {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  });

  await withClient(url, async (client) => {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, quiet);
    await runSeeds(client, quiet);
  });
}

/** Puts the data back to the seed, keeping the schema. Use after tests that change data. */
export async function reseedTestDatabase(url: string): Promise<void> {
  assertTestDatabase(url);
  await withClient(url, async (client) => {
    // Every table hangs off events, so this clears all of them.
    await client.query("TRUNCATE events, processed_stripe_events CASCADE");
    await runSeeds(client, quiet);
  });
}
