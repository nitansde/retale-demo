import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  devIndicators: false,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
export default config;
