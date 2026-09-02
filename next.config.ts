import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  compress: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  // Tree-shake large packages per route
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "react-icons",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-tooltip",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "livekit-client",
    ],
  },
};

export default nextConfig;
