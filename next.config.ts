import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // A separate build directory lets a production build run while `next dev` is
  // using `.next` — the web deploy builds into `.next-web`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: { unoptimized: true },
  trailingSlash: true,
  compress: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  // Tree-shake large packages per route — less JS parsed = less heap
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "react-icons",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-select",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-slider",
      "@radix-ui/react-switch",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "livekit-client",
      "sonner",
      "react-syntax-highlighter",
    ],
  },
};

export default nextConfig;
