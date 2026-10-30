import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { renderMentionsAsText } from "./lib/mentions";
import { publicNotificationBody } from "./lib/e2eeEnforce";
import { mentionKindOf } from "./lib/e2eePure";
import { communityLevel, loadNotificationPolicy } from "./lib/notificationPolicy";
import { historyFloorFor, withinHistory } from "./lib/history";
import { PERMISSIONS, can, getChannelPermissionsBatch } from "./permissions";
import { getCurrentUserOrNull } from "./users";

/**
 * What the unified sidebar shows under each community's name.
 *
 * Kept apart from `communities.listMineActivity`: that one is about badges
 * (counts, voice, unread channels) and is read by the rail; this one is a line
 * of text, and carries message content, so it is only worth subscribing to
 * where that line is drawn.
 */

/** How many of a server's busiest channels are checked for one the caller can
 * actually see before giving up. The newest channel is almost always viewable;
 * the walk is for private channels the caller isn't in. */
const CHANNEL_CANDIDATES = 5;

/** How far back the caller's notifications are searched for a mention. One read
 * shared by every server, so it is bounded rather than per-server. */
const NOTIFICATION_WINDOW = 200;

type CommunityPreview =
  | {
      kind: "message";
      channelId: Id<"channels">;
      channelName: string;
      authorName: string;
      /** Bound into the ciphertext's associated data, so the client needs it to decrypt `enc`. */
      authorId: Id<"users">;
      /** Legacy plaintext rows only. Empty for an encrypted message: the client decrypts `enc`. */
      text: string;
      /** The message's ciphertext as stored, for the client to open; null on a legacy row. */
      enc: Doc<"channelMessages">["enc"] | null;
      messageId: Id<"channelMessages">;
      /** The file's name, when the message was only a file. */
      attachmentName: string | null;
      createdAt: number;
    }
  | {
      kind: "mention";
      channelId: Id<"channels">;
      channelName: string;
      authorName: string;
      /** The mentioning message's author, needed to decrypt `enc`. */
      authorId: Id<"users">;
      /** What pinged the caller: their own name, or the whole room. */
      mention: "you" | "everyone" | "here";
      /** The notification's body: generic for an encrypted message, never its text. */
      text: string;
      /** The mentioning message's ciphertext, for the client to open; null on a legacy row. */
      enc: Doc<"channelMessages">["enc"] | null;
      messageId: Id<"channelMessages"> | null;
      /** Whether the caller has yet to look at it. */
      unread: boolean;
      createdAt: number;
    };

async function displayNameIn(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<string> {
  const [user, profile] = await Promise.all([
    ctx.db.get(userId),
    ctx.db
      .query("serverProfiles")
      .withIndex("by_user_community", (q) => q.eq("userId", userId).eq("communityId", communityId))
      .unique(),
  ]);
  return profile?.displayName ?? user?.name ?? "Someone";
}

/** The newest message in the server, from the newest channel the caller can see. */
async function latestMessage(
  ctx: QueryCtx,
  community: Doc<"communities">,
  me: Id<"users">
): Promise<CommunityPreview | null> {
  const channels = (
    await ctx.db
      .query("channels")
      .withIndex("by_community", (q) => q.eq("communityId", community._id))
      .collect()
  )
    .filter((channel) => channel.type === "text" && !!channel.lastMessageAt)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    .slice(0, CHANNEL_CANDIDATES);

  const permsByChannel = await getChannelPermissionsBatch(ctx, community, channels.map((c) => c._id), me);
  for (const channel of channels) {
    const perms = permsByChannel.get(channel._id) ?? 0;
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) continue;

    const [message] = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .order("desc")
      .take(1);
    if (!message) continue;
    // A line of someone's message is history too: not for a member whose history starts later.
    if (!withinHistory(await historyFloorFor(ctx, channel._id, me, perms), message._creationTime)) continue;

    const attachments = await ctx.db
      .query("channelMessageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .collect();

    return {
      kind: "message",
      channelId: channel._id,
      channelName: channel.name,
      authorName: await displayNameIn(ctx, community._id, message.authorId),
      authorId: message.authorId,
      // An encrypted message has no text the server may read or render.
      text: message.enc ? "" : await renderMentionsAsText(ctx, message.text ?? ""),
      enc: message.enc ?? null,
      messageId: message._id,
      attachmentName: attachments[0]?.fileName ?? null,
      createdAt: message._creationTime,
    };
  }
  return null;
}

/**
 * Whether a notification row is a real ping rather than ordinary traffic
 * delivered because the server is on "all messages". Rows from before
 * `isMention` existed are told apart by their title — see `channelMessages.send`.
 */
function isMentionRow(row: Doc<"notifications">): boolean {
  if (row.type !== "channel_mention") return false;
  return row.isMention ?? row.title.includes(" mentioned you in ");
}

/** `@everyone` and `@here` get their own wording; everything else — the
 * caller's name, one of their roles — reads as "mentioned you".
 *
 * Read from the message's mention metadata when it is encrypted (its notification body is generic,
 * so there is nothing to scan); legacy rows keep scanning the body. */
function mentionKind(
  body: string | undefined,
  message: Doc<"channelMessages"> | null
): "you" | "everyone" | "here" {
  if (message?.enc) return mentionKindOf(message.mentions);
  if (body && /@everyone\b/i.test(body)) return "everyone";
  if (body && /@here\b/i.test(body)) return "here";
  return "you";
}

export const communityPreviews = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];

    const [policy, memberships, recent] = await Promise.all([
      loadNotificationPolicy(ctx, me._id),
      ctx.db
        .query("communityMembers")
        .withIndex("by_user", (q) => q.eq("userId", me._id))
        .collect(),
      ctx.db
        .query("notifications")
        .withIndex("by_user_created", (q) => q.eq("userId", me._id))
        .order("desc")
        .take(NOTIFICATION_WINDOW),
    ]);

    return Promise.all(
      memberships.map(async (membership) => {
        const community = await ctx.db.get(membership.communityId);
        if (!community) return null;

        const level = communityLevel(policy, community._id);
        const base = {
          communityId: community._id,
          bannerUrl: community.bannerUrl ?? null,
          /** "none" is what the settings screen calls muting a server. */
          muted: level === "none",
        };

        // Muted: nothing to say about it, not even a mention.
        if (level === "none") return { ...base, preview: null };

        // Every message needs the server on "all" *and* the account-wide
        // channel-messages switch — the same pair `allowsChannelMessage`
        // asks. Either one off leaves mentions, which is all it ever promised.
        if (level === "all" && policy.channelMessages) {
          return { ...base, preview: await latestMessage(ctx, community, me._id) };
        }

        const row = recent.find(
          (n) => n.communityId === community._id && n.channelId && isMentionRow(n)
        );
        if (!row || !row.channelId || !row.actorId) return { ...base, preview: null };

        const channel = await ctx.db.get(row.channelId);
        if (!channel) return { ...base, preview: null };

        const [actor, mentioning] = await Promise.all([
          ctx.db.get(row.actorId),
          row.channelMessageId ? ctx.db.get(row.channelMessageId) : null,
        ]);
        const preview: CommunityPreview = {
          kind: "mention",
          channelId: channel._id,
          channelName: channel.name,
          authorName: await displayNameIn(ctx, community._id, row.actorId),
          authorId: mentioning?.authorId ?? row.actorId,
          mention: mentionKind(row.body, mentioning),
          // Rows from before enforcement hold the message's text; once it is on they are served
          // generic (system messages excepted).
          text: publicNotificationBody(row, actor) ?? "",
          enc: mentioning?.enc ?? null,
          messageId: row.channelMessageId ?? null,
          unread: !row.read,
          createdAt: row.createdAt,
        };
        return { ...base, preview };
      })
    ).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null));
  },
});
