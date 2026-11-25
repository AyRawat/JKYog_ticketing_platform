import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Env files live at the monorepo root (shared with db scripts). On Vercel, the
// dashboard provides the variables and there are no files, so this is a no-op.
// forceReload: Next has already loaded (and cached) env for apps/web, which has no env files.
const isDev = process.env.NODE_ENV !== "production";
loadEnvConfig(path.resolve(process.cwd(), "../.."), isDev, undefined, true);

// Sent with every response. A Content-Security-Policy is added with the payment page, where
// Stripe's script and frame origins are known.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@ticketing/domain", "@ticketing/contracts", "@ticketing/db"],
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default nextConfig;
