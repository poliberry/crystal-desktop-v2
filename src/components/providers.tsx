"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ClerkProvider, useAuth } from "@clerk/react";
import { dark } from "@clerk/themes";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { getDesktopAPI } from "@/lib/desktop";
import { AudioPreferencesProvider } from "@/components/audio-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { UiPreferencesProvider } from "@/components/ui-preferences-provider";
import { DataPreloader } from "@/components/data-preloader";
import { FileDropGuard } from "@/components/home/composer-attachments";
import { TooltipProvider } from "@/components/ui/tooltip";

const CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

const convex = new ConvexReactClient(CONVEX_URL);

// Listens for crystal://auth/callback IPC events from the main process and
// navigates to the /auth/callback route so Clerk can complete the OAuth flow.
function AuthCallbackHandler() {
  const router = useRouter();

  useEffect(() => {
    const api = getDesktopAPI();
    if (!api?.auth) return;
    const unsub = api.auth.onCallback((url) => {
      try {
        const params = new URL(url).search;
        router.push(`/auth/callback/${params}`);
      } catch {
        // malformed URL — ignore
      }
    });
    return unsub;
  }, [router]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <UiPreferencesProvider>
        <AudioPreferencesProvider>
          <TooltipProvider>
          <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
            <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
              <AuthCallbackHandler />
              <DataPreloader />
              <FileDropGuard />
              {children}
            </ConvexProviderWithClerk>
          </ClerkProvider>
          </TooltipProvider>
        </AudioPreferencesProvider>
      </UiPreferencesProvider>
    </ThemeProvider>
  );
}
