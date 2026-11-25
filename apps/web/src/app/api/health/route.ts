import { sql } from "kysely";
import { getDb } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + DB check: proves the deployed app can reach Postgres and sees the seed. */
export async function GET() {
  try {
    const row = await getDb()
      .selectFrom("events")
      .select(["slug", sql<string>`now()::text`.as("dbTime")])
      .executeTakeFirst();
    return Response.json({ status: "ok", db: "ok", event: row?.slug ?? null, dbTime: row?.dbTime });
  } catch (error) {
    console.error("health check failed", error);
    return Response.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
