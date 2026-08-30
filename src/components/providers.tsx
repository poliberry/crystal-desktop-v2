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
import { CustomCssProvider } from "@/components/custom-css-provider";
import { CustomCssProviderDialog } from "@/components/settings/custom-css-dialog";
import { ProfileEditorProvider } from "@/components/profile/profile-editor-dialog";
import { ProfilePageProvider } from "@/components/profile/profile-page";
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
 * the previous account's cache. Assigning a module-level string is idempotent,
 * so doing it here is safe in a way that most render-phase side effects
 * aren't — it also kicks off that account's IndexedDB hydration (see
 * persistent-cache.ts), which finishes a few renders later and is what
 * `useCacheHydration` is for.
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
      {/* Outside everything: the user's own stylesheet is injected into
          `document.head` and has to be able to reach anything below. */}
      <CustomCssProvider>
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
                  {/* All inside Convex/Clerk: each of these renders something
                      that queries the current user.

                      Settings is outermost of the three dialog hosts because
                      its sidebar is what opens the other two — the profile
                      editor and the CSS editor are reachable from there, and a
                      provider cannot be used by something above it. */}
                  <CustomCssProviderDialog>
                    <ProfileEditorProvider>
                      <ProfilePageProvider>
                        <SettingsDialogProvider>{children}</SettingsDialogProvider>
                      </ProfilePageProvider>
                    </ProfileEditorProvider>
                  </CustomCssProviderDialog>
                </ConvexProviderWithClerk>
              </ClerkProvider>
            </TooltipProvider>
          </AudioPreferencesProvider>
        </UiPreferencesProvider>
      </AccessibilityProvider>
      </CustomCssProvider>
    </ThemeProvider>
  );
}
