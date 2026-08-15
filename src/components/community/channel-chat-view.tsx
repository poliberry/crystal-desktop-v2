"use client";

import { useQuery } from "convex/react";
import { Hash, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ChannelMessageComposer } from "@/components/community/channel-message-composer";
import { ChannelMessageList } from "@/components/community/channel-message-list";
import { MemberList } from "@/components/community/member-list";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

interface ChannelChatViewProps {
  channelId: Id<"channels">;
  communityId: Id<"communities">;
  name: string;
  topic?: string;
}

export function ChannelChatView({ channelId, communityId, name, topic }: ChannelChatViewProps) {
  const [showMembers, setShowMembers] = useState(true);
  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const canManageMessages = hasPermission(myPermissions, PERMISSIONS.MANAGE_MESSAGES);

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <Hash className="size-4 shrink-0 text-muted-foreground" />
          <p className="shrink-0 text-sm font-semibold">{name}</p>
          {topic && <p className="truncate text-xs text-muted-foreground">— {topic}</p>}

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
        </div>

        <ChannelMessageList channelId={channelId} channelName={name} canManageMessages={canManageMessages} />
        <ChannelMessageComposer channelId={channelId} />
      </div>

      {showMembers && <MemberList communityId={communityId} />}
    </div>
  );
}
