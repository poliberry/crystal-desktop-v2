"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ClerkProvider, useAuth } from "@clerk/react";
import { dark } from "@clerk/themes";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { getDesktopAPI } from "@/lib/desktop";
import { warmSystemEmoji } from "@/lib/system-emoji";
import { pruneExpired, setCacheNamespace } from "@/lib/persistent-cache";
import { pruneAttachmentCache, pruneImageCache } from "@/lib/image-cache";
import { setOutboxUser } from "@/lib/outbox";
import { OutboxFlusher } from "@/components/outbox-flusher";
import { OutboxStatus } from "@/components/outbox-status";
import { AccessibilityProvider } from "@/components/accessibility-provider";
import { AudioPreferencesProvider } from "@/components/audio-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemePackProvider } from "@/components/theme-pack-provider";
import { ExtensionsProvider } from "@/extensions/extensions-provider";
import { UiPreferencesProvider } from "@/components/ui-preferences-provider";
import { AccountSuspendedGate } from "@/components/account-suspended-gate";
import { AppLoadingGate } from "@/components/app-loading-gate";
import { DataPreloader } from "@/components/data-preloader";
import { ErrorBoundary } from "@/components/error-boundary";
import { FileDropGuard } from "@/components/home/composer-attachments";
import { CustomCssProvider } from "@/components/custom-css-provider";
import { CustomCssProviderDialog } from "@/components/settings/custom-css-dialog";
import { ProfilePageProvider } from "@/components/profile/profile-page";
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
/**
 * Adds the Noto Color Emoji stylesheet without holding anything up.
 *
 * It was a CSS `@import` at the top of globals.css, which the browser must finish before it paints anything: with no network
 * (a packaged desktop app often has none) that is a wait for a DNS or connection timeout on every launch. As a `<link>`
 * added after the page is up, the emoji font simply arrives when it arrives, and `font-display: swap` in its address means
 * emoji drawn before then use the system's font and are swapped in place.
 */
function DeferredEmojiFont() {
  // The Unicode emoji data for `:shortcodes:` and the picker is its own chunk now (see system-emoji.ts): fetch it at the
  // same quiet moment as the font, so it is there before anyone types a colon.
  useEffect(() => warmSystemEmoji(), []);

  useEffect(() => {
    if (document.getElementById("crystal-emoji-font")) return;
    const add = () => {
      const link = document.createElement("link");
      link.id = "crystal-emoji-font";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap";
      document.head.appendChild(link);
    };
    // After the first screen has had its time: idle if the browser says so, a couple of seconds at the latest.
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(add, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = setTimeout(add, 2000);
    return () => clearTimeout(handle);
  }, []);
  return null;
}

function CacheScope() {
  const { userId } = useAuth();
  // Cache namespace is safe to set during render (idempotent string assign).
  setCacheNamespace(userId);

  useEffect(() => {
    // Outbox switch triggers notify() -> useSyncExternalStore update on
    // OutboxFlusher. Doing it during render = "Cannot update OutboxFlusher
    // while rendering CacheScope" (react.dev/link/setstate-in-render).
    setOutboxUser(userId);
  }, [userId]);

  // Housekeeping, not startup: each pass opens a cursor over a whole IndexedDB store, which competes with the cache
  // hydration and the first queries for the same disk. A few seconds in, nobody can tell.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      pruneExpired();
      pruneImageCache();
      pruneAttachmentCache();
    }, 4000);
    return () => window.clearTimeout(timer);
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
                  <DeferredEmojiFont />
                  {/* Over everything while the app is starting or offline. */}
                  <AppLoadingGate />
                  <AuthCallbackHandler />
                  {/* Only warms caches and draws nothing, so if it fails the app carries on without it. */}
                  <ErrorBoundary silent label="Data preloader">
                    <DataPreloader />
                  </ErrorBoundary>
                  <OutboxFlusher />
                  <OutboxStatus />
                  <FileDropGuard />
                  {/* All inside Convex/Clerk: each of these renders something
                      that queries the current user.

                      Settings, the profile editor and community settings are
                      pages now, tabs drawn by HomeLayout.
                      The CSS editor is still a dialog, and still has to be
                      above them: Settings is where it is opened from. */}
                  <CustomCssProviderDialog>
                    <AccountSuspendedGate>
                      <ThemePackProvider>
                        <ExtensionsProvider>
                          <ProfilePageProvider>{children}</ProfilePageProvider>
                        </ExtensionsProvider>
                      </ThemePackProvider>
                    </AccountSuspendedGate>
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
