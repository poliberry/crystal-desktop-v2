import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // Relative asset paths so the static export works when loaded via
  // Electron's file:// protocol (otherwise /_next/* resolves to disk root).
  // Only applied to the static build: in dev, a relative assetPrefix breaks the
  // HMR WebSocket path detection in Next's router server (it computes the HMR
  // prefix from this value), so the debug channel never closes and hydration
  // hangs. Dev serves over http:// so it doesn't need a relative prefix.
  assetPrefix: process.env.NODE_ENV === "production" ? "./" : "",
};

export default nextConfig;
