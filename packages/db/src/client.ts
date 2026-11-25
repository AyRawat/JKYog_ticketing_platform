import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./database.generated";

// Keep DATE columns as ISO strings ("2026-12-10"). Parsing them into JS Dates
// would shift festival days by the server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Database = Kysely<DB>;

export interface CreateDbOptions {
  /** Keep small on serverless: each warm function instance holds its own pool. */
  maxConnections?: number;
  /** Hook for the host runtime, e.g. Vercel's `attachDatabasePool`, to manage idle connections. */
  onPoolCreated?: (pool: pg.Pool) => void;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({ connectionString, max: options.maxConnections ?? 5 });
  options.onPoolCreated?.(pool);
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
