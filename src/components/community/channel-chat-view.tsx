"use client";

import { useMutation, useQuery } from "convex/react";
import { Hash, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import moment from "moment";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ChannelMessageComposer } from "@/components/community/channel-message-composer";
import { ChannelMessageList } from "@/components/community/channel-message-list";
import { TypingIndicator } from "@/components/typing-indicator";
import { MemberList } from "@/components/community/member-list";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChannelBanner, ChatBackground } from "@/components/chat-decoration";
import { useWindowFocus } from "@/hooks/use-window-focus";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

interface ChannelChatViewProps {
  channelId: Id<"channels">;
  communityId: Id<"communities">;
  name: string;
  topic?: string;
}

export function ChannelChatView({
  channelId,
  communityId,
  name,
  topic,
}: ChannelChatViewProps) {
  const [showMembers, setShowMembers] = useState(true);
  const markRead = useMutation(api.channels.markRead);
  const unread = useQuery(api.channels.unreadInfo, { channelId });
  const focused = useWindowFocus();
  const [atBottom, setAtBottom] = useState(true);

  /**
   * What was waiting when this channel was opened.
   *
   * Frozen for the visit rather than read live: being marked read the moment
   * you arrive is the point, and a live count would make the bar vanish
   * before you'd finished reading it.
   */
  const [missed, setMissed] = useState<{ count: number; since: number | null } | null>(null);
  const measuredFor = useRef<Id<"channels"> | null>(null);

  useEffect(() => {
    if (measuredFor.current === channelId) return;
    setMissed(null);
    // Wait for a real value: `undefined` is "still loading", and treating it
    // as zero would skip the bar on every navigation.
    if (unread === undefined) return;
    measuredFor.current = channelId;
    if (unread.count > 0) setMissed({ count: unread.count, since: unread.since });
  }, [channelId, unread]);

  /**
   * Read means read *by someone who was there*: the window focused on this
   * channel, or the reader having scrolled to the end of it. A channel sitting
   * in a background window, or one opened and left scrolled up in history,
   * stays unread — which is what makes the bar's button worth having.
   *
   * Waits for the measurement above so arriving doesn't erase the count
   * before the bar can show it.
   */
  useEffect(() => {
    if (measuredFor.current !== channelId) return;
    if (!focused && !atBottom) return;
    void markRead({ channelId });
    // `unread.count` so a message landing while you're sitting here is marked
    // read too, rather than leaving the sidebar lit behind you.
  }, [channelId, focused, atBottom, unread?.count, markRead]);

  const dismissBar = () => {
    setMissed(null);
    void markRead({ channelId });
  };

  // The channel's own read, for its decoration. Already cached by the sidebar
  // in most cases, so this is usually free.
  const channel = useQuery(api.channels.get, { channelId });

  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const canManageMessages = hasPermission(
    myPermissions,
    PERMISSIONS.MANAGE_MESSAGES,
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col bg-accent/40 backdrop-blur-xl">
        {/* Behind everything in this column, and outside the scroller so it
            stays put while the messages move. */}
        <ChatBackground
          url={channel?.backgroundUrl}
          opacity={channel?.backgroundOpacity}
        />
        <div className="relative flex h-12 shrink-0 items-center gap-2 px-2">
          <Hash className="size-4 shrink-0 text-muted-foreground" />
          <p className="shrink-0 text-sm font-semibold">{name}</p>
          {topic && (
            <p className="truncate text-xs text-muted-foreground">— {topic}</p>
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-7"
                  onClick={() => setShowMembers((v) => !v)}
                >
                  {showMembers ? (
                    <PanelRightClose className="size-4" />
                  ) : (
                    <PanelRightOpen className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {showMembers ? "Hide member list" : "Show member list"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <ChannelBanner
          imageUrl={channel?.bannerUrl}
          title={channel?.bannerTitle}
          description={channel?.bannerDescription}
        />

        {/* What you missed, under the header where the header's own border
            would be — dismissible, because once you've read it the count is
            no longer telling you anything. */}
        {missed && (
          <div className="flex shrink-0 items-center gap-2 bg-primary/15 px-3 py-1 text-xs text-primary">
            <span className="min-w-0 flex-1 truncate">
              {missed.count === 1 ? "1 new message" : `${missed.count} new messages`}
              {missed.since ? ` since ${moment(missed.since).fromNow()}` : ""}
            </span>
            <button
              type="button"
              onClick={dismissBar}
              className="shrink-0 font-medium hover:underline"
            >
              Mark as read
            </button>
          </div>
        )}

        <ChannelMessageList
          channelId={channelId}
          channelName={name}
          communityId={communityId}
          canManageMessages={canManageMessages}
          onAtBottomChange={setAtBottom}
        />
        <TypingIndicator channelId={channelId} />
        <ChannelMessageComposer channelId={channelId} communityId={communityId} />
      </div>

      {showMembers && <MemberList communityId={communityId} />}
    </div>
  );
}
