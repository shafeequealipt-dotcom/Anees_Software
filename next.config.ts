import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "@electric-sql/pglite", "@react-pdf/renderer", "exceljs"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // `npx tsc --noEmit` is run by hand before every push and must be clean; skipping the build's own
  // (redundant) type-check pass avoids the memory spike that killed it on the small deploy host.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
