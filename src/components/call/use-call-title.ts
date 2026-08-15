"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { ActiveCall } from "@/components/call/call-provider";

/** Display name for the active call: the DM's title, or "Channel / Community" for a voice channel. */
export function useCallTitle(activeCall: ActiveCall | null): string {
  const conversation = useQuery(
    api.conversations.get,
    activeCall?.kind === "dm" ? { conversationId: activeCall.conversationId } : "skip"
  );
  const channel = useQuery(
    api.channels.get,
    activeCall?.kind === "channel" ? { channelId: activeCall.channelId } : "skip"
  );

  if (!activeCall) return "Call";

  if (activeCall.kind === "dm") {
    if (!conversation) return "Call";
    return conversation.type === "group"
      ? conversation.name || conversation.members.map((m) => m.name).join(", ")
      : (conversation.members[0]?.name ?? "Call");
  }

  if (!channel) return "Call";
  return `${channel.name} / ${channel.communityName}`;
}
