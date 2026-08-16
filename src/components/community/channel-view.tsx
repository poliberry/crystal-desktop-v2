"use client";

import { useQuery } from "convex/react";
import { Hash } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ChannelChatView } from "@/components/community/channel-chat-view";
import { ChannelMessageComposer } from "@/components/community/channel-message-composer";
import { Skeleton } from "@/components/ui/skeleton";

interface ChannelViewProps {
  channelId: Id<"channels">;
}

function ChannelViewSkeleton({ channelId }: { channelId: Id<"channels"> }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* Main column */}
      <div className="flex min-h-0 min-w-0 flex-1 rounded-xl bg-accent/40 backdrop-blur-xl flex-col m-2">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-2">
          <Hash className="size-4 shrink-0 text-muted-foreground" />
          <Skeleton className="h-3.5 w-24" />
        </div>

        {/* Message list */}
        <div className="min-h-0 flex flex-1 overflow-y-auto flex-col justify-end">
          <div className="flex flex-col gap-4 px-4 py-4">
            {[48, 32, 64, 40, 56, 36].map((w, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
                  {i % 2 === 0 && <Skeleton className="h-3.5" style={{ width: `${w - 12}%` }} />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Real composer — functional immediately, no skeleton */}
        <ChannelMessageComposer channelId={channelId} />
      </div>

      {/* Member list panel — skeleton rows */}
      <div className="flex w-56 shrink-0 flex-col rounded-xl bg-accent/40 backdrop-blur-xl m-2">
        <div className="flex flex-col gap-2 p-2 pt-3">
          <Skeleton className="mx-2 mb-1 h-2.5 w-16" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <Skeleton className="h-3" style={{ width: `${45 + (i % 3) * 18}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
