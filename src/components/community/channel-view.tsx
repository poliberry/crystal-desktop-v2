"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ChannelChatView } from "@/components/community/channel-chat-view";

interface ChannelViewProps {
  channelId: Id<"channels">;
}

export function ChannelView({ channelId }: ChannelViewProps) {
  const channel = useQuery(api.channels.get, { channelId });

  if (channel === undefined) {
    return (
      <ChannelChatView
        channelId={channelId}
        communityId={channel?.communityId}
        name={channel?.name}
        topic={channel?.topic}
      />
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

  return (
    <ChannelChatView
      channelId={channelId}
      communityId={channel.communityId}
      name={channel.name}
      topic={channel.topic}
    />
  );
}
