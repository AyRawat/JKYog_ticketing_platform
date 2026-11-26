// Zod schemas for every request and response, shared by the route handlers and the UI.
// One file per endpoint; common.ts holds the shared building blocks and the error shape.

export * from "./common";
export * from "./catalog";
export * from "./quote";
export * from "./booking";
export * from "./payment";
