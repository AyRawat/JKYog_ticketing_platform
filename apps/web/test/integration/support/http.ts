import { vi } from "vitest";

export const SLUG = "sharad-utsav-2026";
/** Noon in Allen, two weeks before the festival. */
export const BEFORE_FESTIVAL = new Date("2026-11-25T18:00:00Z");
/** Noon in Allen on 12 Dec, mid-festival. */
export const DURING_FESTIVAL = new Date("2026-12-12T18:00:00Z");

type RouteHandler = (
  request: Request,
  context: { params: Promise<{ slug: string }> },
) => Promise<Response>;

export interface CallOptions {
  slug?: string;
  now?: Date;
  method?: string;
  headers?: Record<string, string>;
  /** Sent as-is; otherwise `json` is serialised. */
  rawBody?: BodyInit;
  json?: unknown;
}

/** Calls a route handler the way Next does, with the clock set to `now`. */
export async function call(handler: RouteHandler, path: string, options: CallOptions = {}) {
  const slug = options.slug ?? SLUG;
  vi.setSystemTime(options.now ?? BEFORE_FESTIVAL);

  const hasBody = options.rawBody !== undefined || options.json !== undefined;
  const request = new Request(`http://localhost/api/events/${slug}/${path}`, {
    method: options.method ?? (hasBody ? "POST" : "GET"),
    headers: hasBody ? { "content-type": "application/json", ...options.headers } : options.headers,
    body:
      options.rawBody ?? (options.json === undefined ? undefined : JSON.stringify(options.json)),
    // Required by undici for streamed bodies.
    ...(options.rawBody instanceof ReadableStream ? { duplex: "half" } : {}),
  });

  const response = await handler(request, { params: Promise.resolve({ slug }) });
  const text = await response.text();
  return { response, status: response.status, text, json: JSON.parse(text) as unknown };
}
