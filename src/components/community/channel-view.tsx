"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ChannelChatView } from "@/components/community/channel-chat-view";
import { SurfaceView } from "@/components/community/surfaces/surface-view";
import type { ChannelSurface } from "@/lib/community-kinds";

interface ChannelViewProps {
  channelId: Id<"channels">;
}

export function ChannelView({ channelId }: ChannelViewProps) {
  const channel = useQuery(api.channels.get, { channelId });

  // Opening a channel is what starts a member's history when they lack Read Message History: they
  // see nothing from before this moment. A no-op on the server for everyone who holds it. Runs again
  // if the permission changes under them, so a removal takes effect without leaving the channel.
  const openChannel = useMutation(api.channels.openChannel);
  const readable = !!channel && channel.type !== "voice";
  const canReadHistory = channel?.canReadHistory;
  useEffect(() => {
    if (readable) void openChannel({ channelId }).catch(() => {});
  }, [channelId, readable, canReadHistory, openChannel]);

  if (channel === undefined) {
    return (
      <></>
    );
  }

  if (!channel) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Channel not found.
      </div>
    );
  }

  if (channel.type === "voice") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Click &quot;{channel.name}&quot; in the sidebar to join.
      </div>
    );
  }

  if (channel.surface) {
    return (
      <SurfaceView
        surface={channel.surface as ChannelSurface}
        channelId={channelId}
        communityId={channel.communityId}
        name={channel.name}
        topic={channel.topic}
      />
    );
  }

  return (
    <ChannelChatView
      channelId={channelId}
      communityId={channel.communityId}
      name={channel.name}
      topic={channel.topic}
      isAnnouncement={channel.isAnnouncement}
      canSend={channel.canSend}
    />
  );
}
