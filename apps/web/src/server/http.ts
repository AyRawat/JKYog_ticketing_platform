import "server-only";
import type { ErrorCode, ErrorResponse } from "@ticketing/contracts";
import type { z } from "zod";

/**
 * Sends a 2xx body after parsing it through its response schema. The schema is the allow-list:
 * any field it doesn't declare is dropped, and a body that breaks the contract throws instead of
 * reaching the client.
 */
export function jsonResponse<S extends z.ZodType>(
  schema: S,
  body: z.input<S>,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  return Response.json(schema.parse(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

/** Error responses are never cached and always use the shared `{ error: { code, message } }` shape. */
export function errorResponse(status: number, code: ErrorCode, message: string): Response {
  const body: ErrorResponse = { error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** For unexpected failures: log the detail on the server, tell the client nothing about it. */
export function internalError(context: string, error: unknown): Response {
  console.error(context, error);
  return errorResponse(
    500,
    "INTERNAL_ERROR",
    "Something went wrong on our side. Please try again.",
  );
}
