"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { AtSign, Bell, Check, Hash, MessageSquare, Trash2, UserPlus } from "lucide-react";
import moment from "moment";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessagePreview } from "@/components/message-preview";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Enough to fill the panel twice over without paying for a long history
 * nobody scrolls. */
const PAGE_SIZE = 25;

/** Past this the badge would outgrow the button it sits on, and the exact
 * number stops being the useful part. */
const BADGE_CAP = 99;

type NotificationType = "dm_message" | "channel_mention" | "friend_request" | "friend_accept";

const TYPE_ICON: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  dm_message: MessageSquare,
  channel_mention: AtSign,
  friend_request: UserPlus,
  friend_accept: UserPlus,
};

/**
 * The inbox: everything that happened while you weren't looking, newest first.
 *
 * Reads the notification rows the server already writes for OS notifications
 * and push (see convex/notifications.ts) rather than deriving its own list, so
 * the panel agrees with what was popped on the desktop — including the Do Not
 * Disturb and per-server rules that decided whether anything was written at
 * all.
 */
export function NotificationInbox() {
  const unreadCount = useQuery(api.notifications.unreadCount) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const clearAll = useMutation(api.notifications.clearAll);
  const nav = useNavigation();

  const { results, status, loadMore } = usePaginatedQuery(
    api.notifications.list,
    {},
    { initialNumItems: PAGE_SIZE }
  );

  /** Opening an entry is also acknowledging it. */
  const open = (notification: (typeof results)[number]) => {
    if (!notification.read) void markRead({ notificationId: notification.id });
    if (notification.conversationId) {
      nav.openConversation(notification.conversationId);
    } else if (notification.communityId && notification.channelId) {
      nav.openCommunity(notification.communityId, notification.channelId);
    }
  };

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                className="pointer-events-auto relative flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-accent/60 hover:opacity-100"
                aria-label={
                  unreadCount > 0 ? `Inbox, ${unreadCount} unread` : "Inbox"
                }
              >
                <Bell className="size-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
                    {unreadCount > BADGE_CAP ? `${BADGE_CAP}+` : unreadCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Inbox</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent align="end" className="w-88 p-0">
        <div className="flex items-center justify-between gap-1 border-b px-3 py-2">
          <p className="mr-auto text-sm font-semibold">Inbox</p>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void markAllRead()}
            >
              <Check className="size-3.5" />
              Mark all read
            </Button>
          )}
          {results.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => void clearAll()}
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-96">
          <div className="flex flex-col p-1">
            {status === "LoadingFirstPage" && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">Loading…</p>
            )}
            {status !== "LoadingFirstPage" && results.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nothing here yet.
              </p>
            )}

            {results.map((notification) => {
              const Icon = TYPE_ICON[notification.type as NotificationType] ?? Bell;
              // Where it happened, when that isn't already obvious from the
              // title — a channel mention is worth locating, a DM isn't.
              const location =
                notification.channelName && notification.communityName
                  ? `${notification.communityName} · #${notification.channelName}`
                  : null;

              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => open(notification)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent/60",
                    !notification.read && "bg-accent/30"
                  )}
                >
                  <div className="relative shrink-0">
                    <Avatar size="sm">
                      <AvatarImage
                        src={notification.actor?.imageUrl}
                        alt={notification.actor?.name ?? ""}
                      />
                      <AvatarFallback className="text-[9px]">
                        {(notification.actor?.name ?? "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-background text-muted-foreground">
                      <Icon className="size-2.5" />
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {notification.title}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {moment(notification.createdAt).fromNow(true)}
                      </span>
                    </div>
                    {/* Through the preview renderer, so a message that was
                        mostly a custom emoji does not read as a paragraph of
                        identifier. */}
                    {notification.body && (
                      <MessagePreview
                        text={notification.body}
                        className="block text-xs text-muted-foreground"
                      />
                    )}
                    {location && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                        <Hash className="size-2.5 shrink-0" />
                        {location}
                      </p>
                    )}
                  </div>

                  {!notification.read && (
                    <span
                      aria-hidden
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </button>
              );
            })}

            {status === "CanLoadMore" && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 text-xs"
                onClick={() => loadMore(PAGE_SIZE)}
              >
                Load more
              </Button>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
