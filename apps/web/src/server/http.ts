import "server-only";
import {
  fieldErrors,
  type ErrorCode,
  type ErrorResponse,
  type FieldError,
} from "@ticketing/contracts";
import type { z } from "zod";

/** Larger than any valid request body (the largest allowed quote is about 25 KB). */
export const MAX_BODY_BYTES = 64 * 1024;

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
export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  details?: FieldError[],
): Response {
  const body: ErrorResponse = { error: details ? { code, message, details } : { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Reads a JSON request body and parses it with `schema`, in this order:
 * 415 unless the body is declared as JSON (this also means a cross-site HTML form can't post here
 *     without a CORS preflight, which this API never grants);
 * 413 if it is larger than MAX_BODY_BYTES (checked while reading, not just from Content-Length);
 * 400 INVALID_REQUEST if it isn't JSON or doesn't match the schema, listing every bad field.
 */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.output<S>>> {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return fail(
      errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as application/json."),
    );
  }

  const text = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (text === null) {
    return fail(errorResponse(413, "PAYLOAD_TOO_LARGE", "The request body is too large."));
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(errorResponse(400, "INVALID_REQUEST", "The request body is not valid JSON."));
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return fail(
      errorResponse(
        400,
        "INVALID_REQUEST",
        "Some fields are missing or have the wrong type.",
        fieldErrors(parsed.error),
      ),
    );
  }
  return { ok: true, data: parsed.data };
}

function fail(response: Response): { ok: false; response: Response } {
  return { ok: false, response };
}

/** The body as text, or null as soon as it passes `maxBytes`. */
async function readTextWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
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

/** Unknown and malformed event slugs get the same answer. */
export function eventNotFound(): Response {
  return errorResponse(404, "EVENT_NOT_FOUND", "We couldn't find that event.");
}
