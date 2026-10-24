import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The site has its own lockfile inside the harnesslock repository.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  // Static export: the site is plain HTML/JS and can be hosted on GitHub Pages or any CDN.
  output: "export",
  images: { unoptimized: true },
  basePath: process.env.SITE_BASE_PATH || undefined,
};

export default nextConfig;
