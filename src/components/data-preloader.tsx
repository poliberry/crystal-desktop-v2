"use client";

import { useQuery } from "convex/react";
import { useMemo, useSyncExternalStore } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  getRecentViewsSnapshot,
  getServerSnapshot,
  keyOf,
  subscribeRecentViews,
  type RecentView,
} from "@/lib/recent-views";

/**
 * Warms the Convex queries the app navigates between, so switching sections
 * paints from cache instead of showing an empty pane while a round trip
 * happens.
 *
 * A mounted `useQuery` is a live subscription, which is exactly what makes
 * this work — data isn't fetched once but kept current, so a view opened ten
 * minutes later is still instant. It's also what makes it cost something, so
 * the two kinds of data are treated differently:
 *
 *  - **Structure** — channel lists, categories, roles, permissions, members,
 *    the emoji and soundboard catalogues, per-channel and per-conversation
 *    metadata — is preloaded for everything. It's small, it changes rarely,
 *    and it's what every view blocks on before it can render at all.
 *  - **Message history** is preloaded for a bounded set: everywhere recently
 *    opened, every channel of the server currently being used, and the DM
 *    list. Thirty messages per channel across every channel of every server
 *    is the one thing here that genuinely doesn't scale.
 *
 * Preload args have to match the view's exactly, or the two are separate
 * subscriptions and the work is wasted — hence `PRELOAD_PAGE`, which must
 * stay in step with the `numItems` the message lists request.
 */

const PRELOAD_PAGE = { numItems: 30, cursor: null };

/** Ceiling on warm message histories. Comfortably more than a session moves
 * between, and bounded so a heavily-joined account doesn't open hundreds of
 * live subscriptions at launch. */
const MESSAGE_PRELOAD_BUDGET = 40;

function ChannelMessagesPreloader({ channelId }: { channelId: Id<"channels"> }) {
  useQuery(api.channelMessages.list, { channelId, paginationOpts: PRELOAD_PAGE });
  return null;
}

function ConversationMessagesPreloader({
  conversationId,
}: {
  conversationId: Id<"conversations">;
}) {
  useQuery(api.messages.list, { conversationId, paginationOpts: PRELOAD_PAGE });
  return null;
}

/** What a channel view blocks on before it can decide what to render. */
function ChannelPreloader({ channelId, voice }: { channelId: Id<"channels">; voice: boolean }) {
  useQuery(api.channels.get, { channelId });
  // Voice rosters drive the "who's in here" list under every voice channel
  // row, so they're needed whether or not that channel is being looked at.
  useQuery(api.channels.listVoiceParticipants, voice ? { channelId } : "skip");
  return null;
}

/**
 * A server's structure: its sidebar, its member list, and the permission bits
 * that decide what either of them shows.
 */
function CommunityPreloader({ communityId }: { communityId: Id<"communities"> }) {
  const channels = useQuery(api.channels.list, { communityId }) ?? [];
  useQuery(api.communities.get, { communityId });
  useQuery(api.communities.listMembers, { communityId });
  useQuery(api.channelCategories.list, { communityId });
  useQuery(api.roles.list, { communityId });
  useQuery(api.roles.myPermissions, { communityId });

  return (
    <>
      {channels.map((ch) => (
        <ChannelPreloader key={ch.id} channelId={ch.id} voice={ch.type === "voice"} />
      ))}
    </>
  );
}

function ConversationPreloader({ conversationId }: { conversationId: Id<"conversations"> }) {
  useQuery(api.conversations.get, { conversationId });
  useQuery(api.calls.listParticipants, { conversationId });
  return null;
}

/** Account-wide lists — nothing per-server or per-conversation. */
function AccountPreloader() {
  useQuery(api.users.getCurrentUser);
  useQuery(api.friends.listFriends);
  useQuery(api.friends.listIncomingRequests);
  useQuery(api.friends.listOutgoingRequests);
  useQuery(api.communityEmojis.listAccessible);
  useQuery(api.soundboard.listAccessible);
  return null;
}

function useRecentViews(): RecentView[] {
  return useSyncExternalStore(subscribeRecentViews, getRecentViewsSnapshot, getServerSnapshot);
}

export function DataPreloader() {
  const communities = useQuery(api.communities.listMine) ?? [];
  const conversations = useQuery(api.conversations.listMine) ?? [];
  const recent = useRecentViews();

  // The server being used right now — its channels are the ones about to be
  // clicked through, even the ones never opened before. `channels.list` for it
  // is already subscribed by CommunityPreloader, and Convex dedupes identical
  // subscriptions, so asking again costs nothing.
  const currentCommunityId = recent.find((v) => v.type === "channel")?.communityId as
    | Id<"communities">
    | undefined;
  const currentCommunityChannels =
    useQuery(api.channels.list, currentCommunityId ? { communityId: currentCommunityId } : "skip") ??
    [];

  const conversationIds = conversations.map((c) => c.id);
  const currentChannelIds = currentCommunityChannels
    .filter((c) => c.type === "text")
    .map((c) => c.id);

  const messageTargets = useMemo(() => {
    const chosen: RecentView[] = [];
    const seen = new Set<string>();
    const add = (view: RecentView) => {
      const key = keyOf(view);
      if (seen.has(key) || chosen.length >= MESSAGE_PRELOAD_BUDGET) return;
      seen.add(key);
      chosen.push(view);
    };

    // Recently opened first: that's the list most likely to be revisited, and
    // it's what survives a restart.
    recent.forEach(add);
    conversationIds.forEach((conversationId) => add({ type: "dm", conversationId }));
    currentChannelIds.forEach((channelId) =>
      add({ type: "channel", communityId: currentCommunityId ?? "", channelId })
    );
    return chosen;
    // Joined ids rather than the arrays, whose identities change every time
    // their query re-runs even when the contents are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, conversationIds.join(","), currentChannelIds.join(",")]);

  return (
    <>
      <AccountPreloader />

      {communities.map((c) => (
        <CommunityPreloader key={c.id} communityId={c.id} />
      ))}
      {conversations.map((c) => (
        <ConversationPreloader key={c.id} conversationId={c.id} />
      ))}

      {messageTargets.map((target) =>
        target.type === "dm" ? (
          <ConversationMessagesPreloader
            key={`dm:${target.conversationId}`}
            conversationId={target.conversationId as Id<"conversations">}
          />
        ) : (
          <ChannelMessagesPreloader
            key={`channel:${target.channelId}`}
            channelId={target.channelId as Id<"channels">}
          />
        )
      )}
    </>
  );
}
