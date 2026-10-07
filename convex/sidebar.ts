import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { renderMentionsAsText } from "./lib/mentions";
import { communityLevel, loadNotificationPolicy } from "./lib/notificationPolicy";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
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
      text: string;
      /** The file's name, when the message was only a file. */
      attachmentName: string | null;
      createdAt: number;
    }
  | {
      kind: "mention";
      channelId: Id<"channels">;
      channelName: string;
      authorName: string;
      /** What pinged the caller: their own name, or the whole room. */
      mention: "you" | "everyone" | "here";
      text: string;
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

  for (const channel of channels) {
    const perms = await getChannelPermissions(ctx, community, channel._id, me);
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) continue;

    const [message] = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .order("desc")
      .take(1);
    if (!message) continue;

    const attachments = await ctx.db
      .query("channelMessageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .collect();

    return {
      kind: "message",
      channelId: channel._id,
      channelName: channel.name,
      authorName: await displayNameIn(ctx, community._id, message.authorId),
      text: await renderMentionsAsText(ctx, message.text ?? ""),
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
 * caller's name, one of their roles — reads as "mentioned you". */
function mentionKind(body: string | undefined): "you" | "everyone" | "here" {
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

        const preview: CommunityPreview = {
          kind: "mention",
          channelId: channel._id,
          channelName: channel.name,
          authorName: await displayNameIn(ctx, community._id, row.actorId),
          mention: mentionKind(row.body),
          text: row.body ?? "",
          unread: !row.read,
          createdAt: row.createdAt,
        };
        return { ...base, preview };
      })
    ).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null));
  },
});
