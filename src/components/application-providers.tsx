"use client";

import { useEffect } from "react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

import { createConvexClient } from "@/lib/convex-client";
import { StepUpDialog } from "@/components/auth/step-up-dialog";
import { SessionEndedWatcher } from "@/components/auth/session-ended-watcher";
import { useAuthUserId } from "@/components/auth/auth-state";

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
import { AppLoadingGate } from "@/components/app-loading-gate";
import { DataPreloader } from "@/components/data-preloader";
import { ErrorBoundary } from "@/components/error-boundary";
import { FileDropGuard } from "@/components/home/composer-attachments";
import { CustomCssProvider } from "@/components/custom-css-provider";
import { CustomCssProviderDialog } from "@/components/settings/custom-css-dialog";
import { ProfilePageProvider } from "@/components/profile/profile-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { E2eeProvider } from "@/lib/e2ee";
import { Toaster } from "@/components/ui/sonner";
import { MultiAccountSession, useAccountSessions } from "@/components/auth/multi-account-session";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

const convex = createConvexClient(CONVEX_URL);

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
  const userId = useAuthUserId();
  const me = useQuery(api.users.getCurrentUser);
  const { remember } = useAccountSessions();
  // Cache namespace is safe to set during render (idempotent string assign).
  setCacheNamespace(userId);

  useEffect(() => {
    // Outbox switch triggers notify() -> useSyncExternalStore update on
    // OutboxFlusher. Doing it during render = "Cannot update OutboxFlusher
    // while rendering CacheScope" (react.dev/link/setstate-in-render).
    setOutboxUser(userId);
  }, [userId]);

  useEffect(() => {
    if (userId && me) void remember({ id: userId, name: me.name, username: me.username, imageUrl: me.imageUrl });
  }, [userId, me?._id, me?.name, me?.username, me?.imageUrl, remember]);

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

export function ApplicationProviders({ children }: { children: React.ReactNode }) {
  return (
    <MultiAccountSession>
      <ApplicationAuthProviders>{children}</ApplicationAuthProviders>
    </MultiAccountSession>
  );
}

function ApplicationAuthProviders({ children }: { children: React.ReactNode }) {
  const { namespace } = useAccountSessions();
  return (
    <ThemeProvider>
      {/* Outside everything: the user's own stylesheet is injected into
          `document.head` and has to be able to reach anything below. */}
      <CustomCssProvider>
      <AccessibilityProvider>
        <UiPreferencesProvider>
          <AudioPreferencesProvider>
            <TooltipProvider>
              {/* `shouldHandleCode` off: a `?code=` in the address is somebody's invite or OAuth return, not ours. */}
              <ConvexAuthProvider key={namespace} client={convex} storageNamespace={`crystal${namespace.replace(/[^a-zA-Z0-9]/g, "")}`} shouldHandleCode={false}>
                <E2eeProvider>
                <>
                  <CacheScope />
                  <DeferredEmojiFont />
                  {/* Over everything while the app is starting or offline. */}
                  <AppLoadingGate />
                  {/* A session ended on the server (banned, suspended, signed out elsewhere): leave, don't limp. */}
                  <SessionEndedWatcher />
                  {/* The code prompt that any administrative function can open. */}
                  <StepUpDialog />
                  {/* Only warms caches and draws nothing, so if it fails the app carries on without it. */}
                  <ErrorBoundary silent label="Data preloader">
                    <DataPreloader />
                  </ErrorBoundary>
                  <OutboxFlusher />
                  <OutboxStatus />
                  <FileDropGuard />
                  {/* In-app notification toasts (sonner). Mounted once per
                      session, above page content. */}
                  <Toaster position="bottom-right" closeButton />
                  {/* All inside Convex: each of these renders something
                      that queries the current user.

                      Settings, the profile editor and community settings are
                      pages now, tabs drawn by HomeLayout.
                      The CSS editor is still a dialog, and still has to be
                      above them: Settings is where it is opened from. */}
                  <CustomCssProviderDialog>
                    <ThemePackProvider>
                      <ExtensionsProvider>
                        <ProfilePageProvider>{children}</ProfilePageProvider>
                      </ExtensionsProvider>
                    </ThemePackProvider>
                  </CustomCssProviderDialog>
                </>
                </E2eeProvider>
              </ConvexAuthProvider>
            </TooltipProvider>
          </AudioPreferencesProvider>
        </UiPreferencesProvider>
      </AccessibilityProvider>
      </CustomCssProvider>
    </ThemeProvider>
  );
}
