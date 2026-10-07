"use client";

import { useAuth } from "@clerk/react";
import { useConvexAuth, useConvexConnectionState, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Lightbulb, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../convex/_generated/api";
import { LogoMark } from "@/components/logo-mark";
import { WindowControls } from "@/components/window-controls";
import { useIsOnline } from "@/hooks/use-is-online";
import { APP_LINKS } from "@/lib/app-links";
import { pickTip } from "@/lib/tips";

/** How long the screen has been up before it offers help. */
const HELP_AFTER_MS = 8000;
/** A dropped connection has to last this long before it covers the app — a
 * blip that heals in a second shouldn't blank everything. */
const DROP_GRACE_MS = 4000;

/**
 * The full-screen loading overlay.
 *
 * Covers the app while it can't be used: while it is starting (the sign-in
 * state and the signed-in user still coming in), and whenever there is no
 * connection — the computer being offline, or the connection to Crystal's
 * servers being down for more than a few seconds. It goes as soon as the app
 * can be used, and comes back if the connection is lost.
 *
 * Lives inside the Clerk and Convex providers, because "is the app ready" is a
 * question those answer.
 */
export function AppLoadingGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading: convexAuthLoading, isAuthenticated } = useConvexAuth();
  const connection = useConvexConnectionState();
  const online = useIsOnline();
  // Only asked once there is somebody to ask about; until then it would be
  // asking Convex for an answer it can't give yet.
  const user = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");

  // The socket having dropped is only a reason to cover the app once it has
  // stayed dropped.
  const socketUp = connection.isWebSocketConnected;
  const [dropped, setDropped] = useState(false);
  useEffect(() => {
    if (socketUp || !connection.hasEverConnected) {
      setDropped(false);
      return;
    }
    const timer = window.setTimeout(() => setDropped(true), DROP_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [socketUp, connection.hasEverConnected]);

  const starting =
    !isLoaded || (isSignedIn === true && (convexAuthLoading || (isAuthenticated && user === undefined)));
  const offline = !online || dropped;
  const visible = starting || offline;

  return (
    <AnimatePresence>
      {visible && <LoadingScreen key="loading" offline={offline} />}
    </AnimatePresence>
  );
}

export function LoadingScreen({ offline }: { offline: boolean }) {
  // Chosen after mount: a random line during the server render would not match
  // the one the browser picks, and React would complain about it.
  const [tip, setTip] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setTip(pickTip());
    const timer = window.setTimeout(() => setSlow(true), HELP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Whether the browser has taken over from the server render yet — the
  // offline message depends on `navigator`, which the server doesn't have, so
  // it waits for this to avoid disagreeing with what was rendered there.
  const mounted = tip !== null;

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label={offline ? "Offline" : "Loading"}
      className="fixed inset-0 z-[300] flex flex-col items-center bg-background text-foreground"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* The window is frameless and this covers all of it, so it has to be
          something you can still drag, minimise and close. */}
      <div
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        className="flex h-10 w-full shrink-0 items-center justify-end"
      >
        <WindowControls className="border-none" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <Spinner />
        <div className="h-5 text-sm text-muted-foreground">
          {offline && mounted ? (
            <span className="flex items-center gap-2">
              <WifiOff className="size-4" />
              You&apos;re offline. We&apos;ll reconnect as soon as you&apos;re back.
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-5 px-6 pb-10 text-center">
        <div className="min-h-[3.5rem]">
          {tip && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="space-y-1"
            >
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
                <Lightbulb className="size-3.5" />
                Did you know?
              </p>
              <p className="text-sm text-muted-foreground">{tip}</p>
            </motion.div>
          )}
        </div>

        <AnimatePresence>
          {slow && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-2 border-t border-foreground/10 pt-4"
            >
              <p className="text-sm font-medium">App taking a while?</p>
              <div className="flex items-center justify-center gap-2">
                <HelpLink href={APP_LINKS.x}>Our X page</HelpLink>
                <HelpLink href={APP_LINKS.status}>System status</HelpLink>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function HelpLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/5 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-foreground/10"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

/** The mark with a ring turning round it, in the theme's own colours. */
function Spinner() {
  return (
    <div className="relative flex size-28 items-center justify-center">
      <svg
        viewBox="0 0 100 100"
        aria-hidden
        className="absolute inset-0 size-full animate-spin [animation-duration:1.4s]"
      >
        {/* The track, faint, and the arc turning on it. */}
        <circle cx="50" cy="50" r="46" fill="none" strokeWidth="3" className="stroke-foreground/10" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="72 217"
          className="stroke-primary"
        />
      </svg>
      <LogoMark className="size-12 text-foreground" />
    </div>
  );
}
