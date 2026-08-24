import type { NextConfig } from "next";

const config: NextConfig = {
  // Static export: Firebase Hosting serves the files, and every dynamic path is a callable
  // Cloud Function (the `generate` proxy, plus the sign-in gatekeeper and the admin
  // callables), so there is nothing left to SSR. Note this means lib/firebase.ts runs under
  // Node at build time — anything browser-only there must be `typeof window` guarded.
  output: "export",
  images: { unoptimized: true },
};

export default config;
