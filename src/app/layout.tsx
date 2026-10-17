import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/providers";
import { PRE_HYDRATION_SCRIPT } from "@/lib/pre-hydration-script";

import "./globals.css";

export const metadata: Metadata = {
  title: "Crystal — Find your people",
  description:
    "Good conversations, shared communities, voice and tools to make something of your own. Find your people on Crystal.",
  // Installable as an app on phones and desktops (see public/manifest.webmanifest and public/sw.js).
  manifest: "/manifest.webmanifest",
  applicationName: "Crystal",
  appleWebApp: { capable: true, title: "Crystal", statusBarStyle: "black-translucent" },
  icons: { apple: "/pwa/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

/**
 * `viewportFit: cover` lets the app draw under the notch and home indicator (the shell pads itself with
 * `env(safe-area-inset-*)`), and `resizes-content` shrinks the layout when the keyboard opens, so the
 * composer stays above it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0b0d12",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `suppressHydrationWarning`: the script below changes <html>'s class and style before React looks at them, which is the
    // point of it. Only this element is exempt — nothing inside it is.
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <head>
        {/* Before the first paint: the saved theme and accessibility classes. See pre-hydration-script.ts. */}
        <script dangerouslySetInnerHTML={{ __html: PRE_HYDRATION_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
