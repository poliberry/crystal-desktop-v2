import type { Metadata } from "next";

import { Providers } from "@/components/providers";
import { PRE_HYDRATION_SCRIPT } from "@/lib/pre-hydration-script";

import "./globals.css";

export const metadata: Metadata = {
  title: "Crystal — LiveKit Voice & Video Chat",
  description:
    "Simple voice & video chat desktop app powered by LiveKit, Next.js, shadcn/ui and Electron.",
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
