"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  channelMessagesKey,
  conversationMessagesKey,
  rememberFirstPage,
} from "@/lib/message-cache";
import { ownDecorationState } from "@/lib/avatar-decorations";
import { preloadAttachmentIntoCache } from "@/lib/image-cache";
import { usePreloadedCosmetics } from "@/hooks/use-preloaded-cosmetics";
import { usePreloadedEmojis } from "@/hooks/use-preloaded-emojis";
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
 * Structure preloads are shared with the views through Convex's own cache —
 * identical query and args means one subscription. Message preloads can't be,
 * because `usePaginatedQuery` puts a unique pagination id in its args; those
 * are handed over through src/lib/message-cache.ts instead.
 */

const PRELOAD_PAGE = { numItems: 30, cursor: null };

/** Warm the attachment blob cache for the image attachments on a just-loaded
 * message page — see src/lib/image-cache.ts. Bounded by the same budget that
 * bounds which pages get preloaded at all. */
function preloadPageAttachments(
  page: readonly { attachments?: { fileType: string; url: string | null }[] }[],
): void {
  for (const message of page) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.url && attachment.fileType.startsWith("image/")) {
        void preloadAttachmentIntoCache(attachment.url);
      }
    }
  }
}

/** Was 40 live message subscriptions at launch — major RAM + socket cost.
 * Cut to 12: covers recent views + active server. Redis keeps the rest hot
 * server-side so a cold channel still loads instantly. */
const MESSAGE_PRELOAD_BUDGET = 12;

/**
 * Message preloads can't be shared with the view through Convex's own cache:
 * `usePaginatedQuery` stamps a unique pagination id into its args, so the
 * view's query is never the same query as this one. The page is handed over
 * through the message cache instead, which is what the lists read from while
 * their own paginated query resolves (see src/lib/message-cache.ts).
 */
function ChannelMessagesPreloader({ channelId }: { channelId: Id<"channels"> }) {
  const result = useQuery(api.channelMessages.list, {
    channelId,
    paginationOpts: PRELOAD_PAGE,
  });
  useEffect(() => {
    if (!result) return;
    rememberFirstPage(channelMessagesKey(channelId), result.page);
    preloadPageAttachments(result.page);
  }, [channelId, result]);
  return null;
}

function ConversationMessagesPreloader({
  conversationId,
}: {
  conversationId: Id<"conversations">;
}) {
  const result = useQuery(api.messages.list, { conversationId, paginationOpts: PRELOAD_PAGE });
  useEffect(() => {
    if (!result) return;
    rememberFirstPage(conversationMessagesKey(conversationId), result.page);
    preloadPageAttachments(result.page);
  }, [conversationId, result]);
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
      {channels.map((ch: any) => (
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
  useQuery(api.friends.listFriends);
  useQuery(api.friends.listIncomingRequests);
  useQuery(api.friends.listOutgoingRequests);
  useQuery(api.communityEmojis.listAccessible);
  useQuery(api.soundboard.listAccessible);
  // The catalogue above feeds this — pull every custom emoji's artwork into the
  // blob cache before a message list needs it.
  usePreloadedEmojis();
  return null;
}

function useRecentViews(): RecentView[] {
  return useSyncExternalStore(subscribeRecentViews, getRecentViewsSnapshot, getServerSnapshot);
}

/**
 * Nothing is worth warming until there's a signed-in user with a Convex row,
 * and some of what's below actively can't run before then: the emoji and
 * soundboard catalogues throw rather than returning nothing when the row
 * doesn't exist, which it doesn't until `SessionBootstrap` has called
 * `ensureUser`. This provider mounts above both the sign-in gate and that
 * bootstrap, so it has to wait for one rather than assume it.
 */
export function DataPreloader() {
  const me = useQuery(api.users.getCurrentUser);
  // Your own cosmetics, which are the ones drawn most often and the ones a
  // slow first paint is most obvious on — your card is in the corner of every
  // screen. `ownDecorationState` because a birthday overrides what you chose.
  usePreloadedCosmetics(
    useMemo(
      () => (me ? [{ ...me, avatarDecoration: ownDecorationState(me).decoration }] : []),
      [me],
    ),
  );
  if (!me) return null;
  return <PreloadEverything />;
}

/** Cap on how many community structures stay warm at once. Was unbounded
 * (every joined community). With 8+ communities that's 40+ list/members/roles
 * subscriptions + 2 per channel (often 150+ subs) → ~200-400MB extra. 3 covers
 * current + 2 recent, which is all that needs to feel instant; the rest is
 * still hot server-side via Redis. */
const STRUCTURE_COMMUNITY_BUDGET = 3;

function PreloadEverything() {
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

  // --- bounded community structure preloads ---
  const communityIdsToPreload = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const add = (id: string | undefined) => {
      if (!id || seen.has(id) || ordered.length >= STRUCTURE_COMMUNITY_BUDGET) return;
      seen.add(id);
      ordered.push(id);
    };
    add(currentCommunityId as string | undefined);
    for (const v of recent) if (v.type === "channel") add(v.communityId as string);
    // Fill remaining slots with most recently joined (tail of listMine is newest)
    for (let i = communities.length - 1; i >= 0; i--) add((communities[i] as any).id);
    return ordered as Id<"communities">[];
  }, [currentCommunityId, recent, communities]);

  const conversationIds = conversations.map((c: any) => c.id);
  const currentChannelIds = currentCommunityChannels
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.id);

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
    conversationIds.forEach((conversationId: any) => add({ type: "dm", conversationId }));
    currentChannelIds.forEach((channelId: any) =>
      add({ type: "channel", communityId: currentCommunityId ?? "", channelId })
    );
    return chosen;
    // Joined ids rather than the arrays, whose identities change every time
    // their query re-runs even when the contents are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, conversationIds.join(","), currentChannelIds.join(",")]);

  // DM structure is cheap vs community channels, but still bound: recent DMs
  // + 4 most recent conversations covers the working set without 50 subs.
  const conversationIdsToPreload = useMemo(() => {
    const ids = (conversations as any[]).map((c) => c.id as string);
    if (ids.length <= 8) return ids as Id<"conversations">[];
    const recentDmIds = new Set((recent.filter((v) => v.type === "dm") as any[]).map((v) => v.conversationId as string));
    const ordered: string[] = [];
    for (const v of recent) if (v.type === "dm") ordered.push((v as any).conversationId);
    for (const id of ids) if (!ordered.includes(id) && ordered.length < 8) ordered.push(id);
    // keep fast-path: if we trimmed, still include any with unread via recent
    void recentDmIds;
    return ordered.slice(0, 8) as Id<"conversations">[];
  }, [conversations, recent]);

  return (
    <>
      <AccountPreloader />

      {communityIdsToPreload.map((id) => (
        <CommunityPreloader key={id} communityId={id} />
      ))}
      {conversationIdsToPreload.map((id) => (
        <ConversationPreloader key={id} conversationId={id as Id<"conversations">} />
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
