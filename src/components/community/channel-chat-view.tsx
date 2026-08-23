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

  /** What was waiting when this channel was opened, for the catch-up bar. */
  const [missed, setMissed] = useState<{ count: number; since: number | null } | null>(null);
  // Which channel `missed` describes, so a message arriving while you're
  // already here doesn't replace the bar with "1 new message".
  const measuredFor = useRef<Id<"channels"> | null>(null);

  // Looking at a channel is what marks it read. Keyed on the newest message
  // rather than just the channel, so a message arriving while it's already on
  // screen doesn't leave the indicator lit behind you.
  const newest = useQuery(api.channels.newestMessageAt, { channelId });
  useEffect(() => {
    const firstVisit = measuredFor.current !== channelId;
    if (firstVisit) setMissed(null);
    void markRead({ channelId }).then((result) => {
      measuredFor.current = channelId;
      if (firstVisit && result && result.unreadCount > 0) {
        setMissed({ count: result.unreadCount, since: result.since });
      }
    });
  }, [channelId, newest, markRead]);

  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const canManageMessages = hasPermission(
    myPermissions,
    PERMISSIONS.MANAGE_MESSAGES,
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-accent/40 backdrop-blur-xl">
        <div className="flex h-12 shrink-0 items-center gap-2 px-2">
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
              onClick={() => setMissed(null)}
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
        />
        <TypingIndicator channelId={channelId} />
        <ChannelMessageComposer channelId={channelId} communityId={communityId} />
      </div>

      {showMembers && <MemberList communityId={communityId} />}
    </div>
  );
}
