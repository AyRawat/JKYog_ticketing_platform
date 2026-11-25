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
export const ERROR_CODES = ["EVENT_NOT_FOUND", "INTERNAL_ERROR"] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** The body of every non-2xx response. `message` is safe to show to the family. */
export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
