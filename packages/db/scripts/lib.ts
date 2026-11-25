import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(packageRoot, "migrations");
const SEEDS_DIR = path.join(packageRoot, "seeds");
const SEEDED_EVENT_SLUG = "sharad-utsav-2026";
const MIGRATION_LOCK_ID = 7_202_612; // arbitrary, shared by all migration runners

/**
 * Scripts (migrate/seed/reset/codegen) prefer the DIRECT connection: migrations use a
 * session-level advisory lock, which Neon's PgBouncer pooler (transaction mode) can't hold.
 * Locally there is no pooler, so DATABASE_URL is used.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  return url;
}

export async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function inTransaction(client: pg.Client, fn: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await fn();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function sqlFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
}

/** Applies each not-yet-applied migrations/*.sql file, in order, one transaction per file. */
export async function runMigrations(client: pg.Client): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.version));

    for (const file of await sqlFiles(MIGRATIONS_DIR)) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await inTransaction(client, async () => {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      });
      console.log(`migrate: applied ${file}`);
    }
    console.log("migrate: up to date");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  }
}

/** Loads seeds/*.sql in one transaction. Skips if the festival is already seeded. */
export async function runSeeds(client: pg.Client): Promise<void> {
  const existing = await client.query("SELECT 1 FROM events WHERE slug = $1", [SEEDED_EVENT_SLUG]);
  if (existing.rowCount) {
    console.log(
      `seed: '${SEEDED_EVENT_SLUG}' already present, skipping (use db:reset to start over)`,
    );
    return;
  }
  await inTransaction(client, async () => {
    for (const file of await sqlFiles(SEEDS_DIR)) {
      await client.query(await readFile(path.join(SEEDS_DIR, file), "utf8"));
      console.log(`seed: applied ${file}`);
    }
  });
}

/** Wipes the public schema. Refuses anything but a local database unless ALLOW_DB_RESET=1. */
export async function resetSchema(client: pg.Client): Promise<void> {
  const host = new URL(requireDatabaseUrl()).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (!isLocal && process.env.ALLOW_DB_RESET !== "1") {
    throw new Error(
      `Refusing to reset non-local database '${host}'. Set ALLOW_DB_RESET=1 to force.`,
    );
  }
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  console.log(`reset: dropped schema on ${host}`);
}
