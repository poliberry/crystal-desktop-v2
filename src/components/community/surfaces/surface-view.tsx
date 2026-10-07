"use client";

import type { Id } from "../../../../convex/_generated/dataModel";
import { AmaView } from "@/components/community/surfaces/ama-view";
import { FeedView } from "@/components/community/surfaces/feed-view";
import { CalendarView } from "@/components/community/surfaces/calendar-view";
import { LfgView } from "@/components/community/surfaces/lfg-view";
import { RosterView } from "@/components/community/surfaces/roster-view";
import { ServersView } from "@/components/community/surfaces/servers-view";
import { ThreadsView } from "@/components/community/surfaces/threads-view";
import type { ChannelSurface } from "@/lib/community-kinds";

/** What a special channel shows in place of a message list. */
export function SurfaceView({
  surface,
  channelId,
  communityId,
  name,
  topic,
}: {
  surface: ChannelSurface;
  channelId: Id<"channels">;
  communityId: Id<"communities">;
  name: string;
  topic?: string;
}) {
  switch (surface) {
    case "servers":
      return <ServersView communityId={communityId} name={name} topic={topic} />;
    case "roster":
      return <RosterView communityId={communityId} name={name} topic={topic} />;
    case "lfg":
      return <LfgView communityId={communityId} name={name} topic={topic} />;
    case "calendar":
      return <CalendarView communityId={communityId} name={name} topic={topic} />;
    case "feed":
      return <FeedView communityId={communityId} name={name} topic={topic} />;
    case "ama":
      return <AmaView channelId={channelId} communityId={communityId} name={name} topic={topic} />;
    case "threads":
      return <ThreadsView channelId={channelId} communityId={communityId} name={name} topic={topic} />;
  }
}
