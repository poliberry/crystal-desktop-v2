"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ClerkProvider, useAuth } from "@clerk/react";
import { dark } from "@clerk/themes";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { getDesktopAPI } from "@/lib/desktop";
import { pruneExpired, setCacheNamespace } from "@/lib/persistent-cache";
import { AccessibilityProvider } from "@/components/accessibility-provider";
import { AudioPreferencesProvider } from "@/components/audio-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { UiPreferencesProvider } from "@/components/ui-preferences-provider";
import { DataPreloader } from "@/components/data-preloader";
import { FileDropGuard } from "@/components/home/composer-attachments";
import { SettingsDialogProvider } from "@/components/settings/settings-dialog";
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

/**
 * Points the persistent cache at whoever is signed in, and clears out entries
 * that have aged past their TTL.
 *
 * The namespace is set during render rather than in an effect on purpose:
 * everything below reads the cache while it renders, so an effect would run a
 * frame too late and the first paint after switching accounts would come from
 * the previous account's cache. Assigning a module-level string is idempotent
 * and observable to nobody, so doing it here is safe in a way that most
 * render-phase side effects aren't.
 */
function CacheScope() {
  const { userId } = useAuth();
  setCacheNamespace(userId);

  useEffect(() => {
    pruneExpired();
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AccessibilityProvider>
        <UiPreferencesProvider>
          <AudioPreferencesProvider>
            <TooltipProvider>
              <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
                <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
                  <CacheScope />
                  <AuthCallbackHandler />
                  <DataPreloader />
                  <FileDropGuard />
                  {/* Inside Convex/Clerk: the settings shell it renders on the
                      web queries the current user and their presence. */}
                  <SettingsDialogProvider>{children}</SettingsDialogProvider>
                </ConvexProviderWithClerk>
              </ClerkProvider>
            </TooltipProvider>
          </AudioPreferencesProvider>
        </UiPreferencesProvider>
      </AccessibilityProvider>
    </ThemeProvider>
  );
}
