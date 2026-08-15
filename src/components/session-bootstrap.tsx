"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";

import { api } from "../../convex/_generated/api";
import { usePresenceHeartbeat } from "@/hooks/use-presence";
import { useSyncNotifications } from "@/hooks/use-sync-notifications";

/** Bootstraps the current session: syncs the Convex user row and starts the presence heartbeat. Renders nothing. */
export function SessionBootstrap() {
  const ensureUser = useMutation(api.users.ensureUser);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void ensureUser();
  }, [ensureUser]);

  usePresenceHeartbeat();
  useSyncNotifications();

  return null;
}
