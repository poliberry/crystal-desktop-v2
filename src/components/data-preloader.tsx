"use client";

import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

function ChannelMessagesPreloader({ channelId }: { channelId: Id<"channels"> }) {
  useQuery(api.channelMessages.list, {
    channelId,
    paginationOpts: { numItems: 30, cursor: null },
  });
  return null;
}

function VoiceParticipantsPreloader({ channelId }: { channelId: Id<"channels"> }) {
  useQuery(api.channels.listVoiceParticipants, { channelId });
  return null;
}

function CommunityPreloader({ communityId }: { communityId: Id<"communities"> }) {
  const channels = useQuery(api.channels.list, { communityId }) ?? [];
  useQuery(api.communities.listMembers, { communityId });

  return (
    <>
      {channels
        .filter((ch) => ch.type === "text")
        .map((ch) => (
          <ChannelMessagesPreloader key={ch.id} channelId={ch.id} />
        ))}
      {channels
        .filter((ch) => ch.type === "voice")
        .map((ch) => (
          <VoiceParticipantsPreloader key={ch.id} channelId={ch.id} />
        ))}
    </>
  );
}

function ConversationPreloader({ conversationId }: { conversationId: Id<"conversations"> }) {
  useQuery(api.messages.list, {
    conversationId,
    paginationOpts: { numItems: 30, cursor: null },
  });
  useQuery(api.calls.listParticipants, { conversationId });
  return null;
}

export function DataPreloader() {
  const communities = useQuery(api.communities.listMine) ?? [];
  const conversations = useQuery(api.conversations.listMine) ?? [];

  return (
    <>
      {communities.map((c) => (
        <CommunityPreloader key={c.id} communityId={c.id} />
      ))}
      {conversations.map((c) => (
        <ConversationPreloader key={c.id} conversationId={c.id} />
      ))}
    </>
  );
}
