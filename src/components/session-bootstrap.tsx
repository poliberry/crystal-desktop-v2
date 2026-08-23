"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";

import { api } from "../../convex/_generated/api";
import { useSyncMyAvatarAccent } from "@/hooks/use-avatar-accent";
import { usePresenceHeartbeat } from "@/hooks/use-presence";
import { useMessageSound } from "@/hooks/use-message-sound";
import { useRichPresenceReporter } from "@/hooks/use-rich-presence";
import { useSyncNotifications } from "@/hooks/use-sync-notifications";

/** Bootstraps the current session: syncs the Convex user row, starts the
 * presence heartbeat, and mirrors detected Rich Presence activity. Renders
 * nothing. */
export function SessionBootstrap() {
  const ensureUser = useMutation(api.users.ensureUser);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void ensureUser();
  }, [ensureUser]);

  useSyncMyAvatarAccent();
  usePresenceHeartbeat();
  useRichPresenceReporter();
  useMessageSound();
  useSyncNotifications();

  return null;
}
