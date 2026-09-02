"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { TabTarget } from "@/components/home/tabs-context";

/**
 * Keeps the OS window title in step with whatever's actually on screen.
 *
 * Electron mirrors a page's `document.title` onto the real window title by
 * itself (`page-title-updated`, unhandled in electron/main.ts) — the custom
 * titlebar this app draws never shows it, but the taskbar button, Alt+Tab and
 * the system tray tooltip all read it, and a fixed "Crystal" there is a
 * chat app that can't tell you which chat you're looking at without a click.
 *
 * One small component per kind of target rather than a single one with three
 * queries behind an `? :`, so switching to a DM never pays for a channel
 * query it isn't using — the same reason tab-bar.tsx's labels are split up
 * the same way.
 */

const APP_NAME = "Crystal";

/** Matches the taskbar badge (`use-app-badge.ts`), which reads the same
 * count — a title that says "(147)" next to a badge that says "99+" is a bug
 * report, not a feature. */
const UNREAD_CAP = 99;

function titleSuffix(unread: number | undefined): string {
  if (!unread) return "";
  return ` (${unread > UNREAD_CAP ? `${UNREAD_CAP}+` : unread})`;
}

function DmWindowTitle({
  conversationId,
  unread,
}: {
  conversationId: Id<"conversations">;
  unread: number | undefined;
}) {
  const conversation = useQuery(api.conversations.get, { conversationId });

  useEffect(() => {
    if (!conversation) return;
    const label =
      conversation.type === "group"
        ? conversation.name || conversation.members.map((m: any) => m.name).join(", ")
        : `@${conversation.members[0]?.username ?? "unknown"}`;
    document.title = `${label} - ${APP_NAME}${titleSuffix(unread)}`;
  }, [conversation, unread]);

  return null;
}

function ChannelWindowTitle({
  channelId,
  unread,
}: {
  channelId: Id<"channels">;
  unread: number | undefined;
}) {
  const channel = useQuery(api.channels.get, { channelId });

  useEffect(() => {
    if (!channel) return;
    document.title = `#${channel.name} | ${channel.communityName} - ${APP_NAME}${titleSuffix(unread)}`;
  }, [channel, unread]);

  return null;
}

export function WindowTitle({ target }: { target: TabTarget }) {
  // The same count the app icon's badge and the notification inbox show —
  // see use-app-badge.ts.
  const unread = useQuery(api.notifications.unreadCount);

  useEffect(() => {
    if (target.type !== "home") return;
    document.title = `${APP_NAME}${titleSuffix(unread)}`;
  }, [target.type, unread]);

  if (target.type === "dm") {
    return <DmWindowTitle conversationId={target.conversationId} unread={unread} />;
  }
  if (target.type === "channel") {
    return <ChannelWindowTitle channelId={target.channelId} unread={unread} />;
  }
  return null;
}
