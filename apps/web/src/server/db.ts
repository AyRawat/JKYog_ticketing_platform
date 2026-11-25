import "server-only";
import { createDb, type Database } from "@ticketing/db";
import { attachDatabasePool } from "@vercel/functions";

// One pool per warm serverless instance, created on first use (not at import,
// so `next build` never needs a database).
let db: Database | undefined;

export function getDb(): Database {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // DATABASE_URL is Neon's pooled (-pooler) string. attachDatabasePool lets Vercel
    // Fluid compute close idle clients before an instance is suspended (no-op locally).
    db = createDb(url, { maxConnections: 3, onPoolCreated: attachDatabasePool });
  }
  return db;
}
