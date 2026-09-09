import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@actual-app/api"],
  outputFileTracingIncludes: {
    "/api/actual/summary": ["./scripts/*.mjs", "../node_modules/@actual-app/**/*", "../node_modules/better-sqlite3/**/*"],
    "/api/ownership": ["./scripts/*.mjs", "../node_modules/@actual-app/**/*", "../node_modules/better-sqlite3/**/*"],
  },
};

export default nextConfig;
