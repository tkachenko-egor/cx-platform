import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (Phase 5 M2, src/kb/pdf-extract.ts) bundles pdfjs-dist, which loads its worker via a
  // relative dynamic import at runtime — Turbopack's server bundling doesn't preserve that sibling
  // file next to the bundled chunk. Excluding it from bundling lets Node resolve it normally from
  // node_modules instead, where the worker file actually sits next to the code that imports it.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
