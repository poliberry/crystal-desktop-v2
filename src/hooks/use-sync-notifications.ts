"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../convex/_generated/api";
import { getDesktopAPI } from "@/lib/desktop";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Keeps the Electron main process's background notifier (see
 * electron/backgroundNotifier.ts) supplied with a live sign-in token — it runs
 * its own headless Convex subscription so notifications still fire while
 * the window is hidden in the tray, but it needs *some* way to authenticate,
 * and only the renderer holds the actual session. Mounted once,
 * app-wide (see session-bootstrap.tsx), independent of whatever view is
 * currently showing.
 *
 * The token is a short-lived JWT that the auth provider refreshes before it
 * runs out, so this only has to pass along whichever one is current.
 */
export function useSyncNotifications(): void {
  const token = useAuthToken();
  const me = useQuery(api.users.getCurrentUser);

  useEffect(() => {
    const desktop = getDesktopAPI();
    if (!desktop) return;
    void desktop.notifications.configure(CONVEX_URL, token && me ? token : null, token && me ? me._id : null);
  }, [token, me]);
}
