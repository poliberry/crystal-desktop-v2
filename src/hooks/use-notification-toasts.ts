"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { getActiveView } from "@/lib/active-view";

/**
 * In-app toasts for new notifications (sonner), so something arriving while
 * the app is open is seen without opening the inbox.
 *
 * Watches only the newest notification's identity — one small subscription
 * update per arrival, same as the message chime (see use-message-sound).
 * Call activity is silent here: the call UI already rings and shows it.
 * Nothing pops for the room already on screen, or while the window is in
 * the background (the OS notification covers that case).
 */
const SILENT_TYPES = new Set(["call_ring", "call_started", "stream_started"]);

export function useNotificationToasts(): void {
  const latest = useQuery(api.notifications.latest);
  const markRead = useMutation(api.notifications.markRead);
  const nav = useNavigation();
  const lastSeen = useRef<string | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    if (latest === undefined) return;

    if (!primed.current) {
      primed.current = true;
      lastSeen.current = latest?.id ?? null;
      return;
    }

    if (!latest || latest.id === lastSeen.current) return;
    lastSeen.current = latest.id;
    if (SILENT_TYPES.has(latest.type)) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const active = getActiveView();
    if (
      active &&
      ((latest.conversationId !== null &&
        active.kind === "conversation" &&
        active.id === latest.conversationId) ||
        (latest.channelId !== null && active.kind === "channel" && active.id === latest.channelId))
    ) {
      return;
    }

    const open = latest.conversationId
      ? () => nav.openConversation(latest.conversationId as Id<"conversations">)
      : latest.communityId && latest.channelId
        ? () =>
            nav.openCommunity(
              latest.communityId as Id<"communities">,
              latest.channelId as Id<"channels">
            )
        : undefined;
    toast(latest.title, {
      description: latest.body ?? undefined,
      action: open
        ? {
            label: "Open",
            onClick: () => {
              void markRead({ notificationId: latest.id });
              open();
            },
          }
        : undefined,
    });
  }, [latest, markRead, nav]);
}

/** Mount inside `NavigationProvider` so the toast's Open button navigates. */
export function NotificationToasts() {
  useNotificationToasts();
  return null;
}
