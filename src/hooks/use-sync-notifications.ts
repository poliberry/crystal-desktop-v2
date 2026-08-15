"use client";

import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../convex/_generated/api";
import { getDesktopAPI } from "@/lib/desktop";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const REFRESH_INTERVAL_MS = 45_000;

/**
 * Keeps the Electron main process's background notifier (see
 * electron/backgroundNotifier.ts) supplied with a live Clerk token — it runs
 * its own headless Convex subscription so notifications still fire while
 * the window is hidden in the tray, but it needs *some* way to authenticate,
 * and only the renderer holds the actual Clerk session. Mounted once,
 * app-wide (see session-bootstrap.tsx), independent of whatever view is
 * currently showing.
 */
export function useSyncNotifications(): void {
  const { isSignedIn, getToken } = useAuth();
  const me = useQuery(api.users.getCurrentUser);

  useEffect(() => {
    const desktop = getDesktopAPI();
    if (!desktop) return;

    let cancelled = false;

    const push = async () => {
      if (!isSignedIn || !me) {
        await desktop.notifications.configure(CONVEX_URL, null, null);
        return;
      }
      const token = await getToken({ template: "convex" });
      if (!cancelled) await desktop.notifications.configure(CONVEX_URL, token, me._id);
    };

    void push();
    const interval = setInterval(() => void push(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isSignedIn, getToken, me]);
}
