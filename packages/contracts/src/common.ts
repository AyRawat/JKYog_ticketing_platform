import { z } from "zod";

/** A calendar date, "YYYY-MM-DD". */
export const IsoDate = z.iso.date();

/** Whole US cents. Money never travels as a float. */
export const Cents = z.number().int().nonnegative();

/** Lowercase words joined by single hyphens: "sharad-utsav-2026". */
export const EventSlug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Every error code an endpoint can return. Clients switch on `code`, never on `message`. */
export const ERROR_CODES = [
  "INVALID_REQUEST",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "EVENT_NOT_FOUND",
  "INTERNAL_ERROR",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** One field that broke the request schema. `path` uses the same form as quote issues. */
export const FieldError = z.object({ path: z.string(), message: z.string() });
export type FieldError = z.infer<typeof FieldError>;

/** The body of every non-2xx response. `message` is safe to show to the family. */
export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Only for INVALID_REQUEST: each field that was wrong. */
    details: z.array(FieldError).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** ["attendees", 1, "entry", "days"] -> "attendees[1].entry.days", the form quote issues use. */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, key) => {
    if (typeof key === "number") return `${out}[${key}]`;
    const name = String(key);
    return out ? `${out}.${name}` : name;
  }, "");
}

/** Every problem in a failed parse, one entry per field; unknown fields are listed by name. */
export function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys"
      ? issue.keys.map((key) => ({
          path: formatPath([...issue.path, key]),
          message: "This field is not allowed.",
        }))
      : [{ path: formatPath(issue.path), message: issue.message }],
  );
}
