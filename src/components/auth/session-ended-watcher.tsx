"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef } from "react";

import { api } from "../../../convex/_generated/api";

/**
 * Notices that the server has ended this session and leaves, instead of limping on.
 *
 * Banning or suspending an account, resetting its password and "sign out everywhere" all delete the
 * account's sessions on the server, at once. The token the app holds stays valid for up to an hour
 * after that, and a valid token for a deleted session reads as signed in but can see nothing. When
 * that happens `getCurrentUser` comes back `null` while Convex still says we're authenticated, which
 * is exactly the signal: sign out here so the app returns to the sign-in screen, where entering the
 * password tells the person why (a ban or suspension is explained there, before anything else).
 *
 * A guest whose day is up ends the same way.
 */
export function SessionEndedWatcher() {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions();
  const seen = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      seen.current = false;
      return;
    }
    if (me) {
      seen.current = true;
      return;
    }
    // `null` (as opposed to still loading): the server doesn't recognise the session. A short grace
    // after the first sign-in, in case the row is still arriving.
    if (me === null) {
      const timer = window.setTimeout(() => void signOut(), seen.current ? 0 : 1500);
      return () => window.clearTimeout(timer);
    }
  }, [isAuthenticated, me, signOut]);

  return null;
}
