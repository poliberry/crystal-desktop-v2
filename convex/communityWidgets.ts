/**
 * The Server Overview — a server's front page.
 *
 * A dashboard of cards a moderator arranges: which channels to read first,
 * what's been said in one of them lately, a paragraph of house rules, a
 * banner. It's the thing a member sees when they arrive, before they've worked
 * out which of thirty channels matters.
 *
 * The widgets are *typed*, unlike a profile's (see convex/profileWidgets.ts):
 * "recent messages in #general" has to be looked up here at read time, so the
 * kind is what tells this file which lookup to do. `listOverview` resolves each
 * one all the way to what the client should draw, so the client never has to
 * know that a channel widget means five more queries.
 */

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import {
  PERMISSIONS,
  getChannelPermissions,
  requireCommunityPermission,
} from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { MAX_PROFILE_ASSET_BYTES, requireWithinUploadLimit } from "./uploadLimits";

/** A dashboard is a summary. Past this it's a channel list with extra steps. */
const MAX_WIDGETS = 16;
/** How many messages a preview card shows, whatever it asked for. */
const MAX_PREVIEW_MESSAGES = 8;
const MAX_LISTED_CHANNELS = 8;

const configValidator = v.union(
  v.object({
    kind: v.literal("channels"),
    channelIds: v.array(v.id("channels")),
    description: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("recentMessages"),
    channelId: v.id("channels"),
    limit: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("markdown"),
    body: v.string(),
  }),
  v.object({
    kind: v.literal("banner"),
    imageUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    heading: v.optional(v.string()),
    subheading: v.optional(v.string()),
    linkUrl: v.optional(v.string()),
    linkLabel: v.optional(v.string()),
  }),
);

async function widgetsOf(
  ctx: QueryCtx,
  communityId: Id<"communities">
): Promise<Doc<"communityWidgets">[]> {
  const rows = await ctx.db
    .query("communityWidgets")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  return rows.sort((a, b) => a.position - b.position);
}

/**
 * Can this member see this channel?
 *
 * Applied to every channel a widget names, rather than trusting the widget:
 * an overview is configured once and read by everyone, so a card listing a
 * staff-only channel must not become a way to learn it exists. Channels the
 * reader can't see are dropped from the card, and a card left with nothing is
 * dropped entirely.
 */
async function visibleTo(
  ctx: QueryCtx,
  community: Doc<"communities">,
  channelId: Id<"channels">,
  userId: Id<"users">
): Promise<boolean> {
  const perms = await getChannelPermissions(ctx, community, channelId, userId);
  return (
    (perms & PERMISSIONS.VIEW_CHANNELS) !== 0 ||
    (perms & PERMISSIONS.ADMINISTRATOR) !== 0
  );
}

/**
 * The overview, resolved for the calling member.
 *
 * Everything a card needs is looked up here — channel names, message previews,
 * author avatars — so the client renders a list of finished cards rather than
 * fanning out a query per widget.
 */
export const listOverview = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const community = await ctx.db.get(communityId);
    if (!community) return [];
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", communityId).eq("userId", me._id)
      )
      .unique();
    if (!membership) return [];

    const widgets = await widgetsOf(ctx, communityId);

    const resolved = await Promise.all(
      widgets.map(async (widget) => {
        const base = {
          id: widget._id,
          title: widget.title,
          width: widget.width ?? "half",
        };
        const config = widget.config;

        if (config.kind === "markdown") {
          return { ...base, kind: "markdown" as const, body: config.body };
        }

        if (config.kind === "banner") {
          return {
            ...base,
            kind: "banner" as const,
            imageUrl: config.imageUrl,
            heading: config.heading,
            subheading: config.subheading,
            linkUrl: config.linkUrl,
            linkLabel: config.linkLabel,
          };
        }

        if (config.kind === "channels") {
          const channels = await Promise.all(
            config.channelIds.slice(0, MAX_LISTED_CHANNELS).map(async (id) => {
              const channel = await ctx.db.get(id);
              if (!channel || channel.communityId !== communityId) return null;
              if (!(await visibleTo(ctx, community, id, me._id))) return null;
              return {
                id: channel._id,
                name: channel.name,
                type: channel.type,
                topic: channel.topic,
              };
            })
          );
          const listed = channels.filter((c): c is NonNullable<typeof c> => !!c);
          // A card whose every channel is hidden from this reader isn't an
          // empty card, it's a card that shouldn't be there.
          if (listed.length === 0) return null;
          return {
            ...base,
            kind: "channels" as const,
            description: config.description,
            channels: listed,
          };
        }

        // recentMessages
        const channel = await ctx.db.get(config.channelId);
        if (!channel || channel.communityId !== communityId) return null;
        if (!(await visibleTo(ctx, community, config.channelId, me._id))) return null;

        const limit = Math.min(config.limit ?? 3, MAX_PREVIEW_MESSAGES);
        const recent = await ctx.db
          .query("channelMessages")
          .withIndex("by_channel", (q) => q.eq("channelId", config.channelId))
          .order("desc")
          .take(limit);

        const messages = await Promise.all(
          recent.map(async (message) => {
            const author = await ctx.db.get(message.authorId);
            return {
              id: message._id,
              text: message.text ?? "",
              createdAt: message._creationTime,
              authorName: author?.name ?? "Unknown",
              authorImageUrl: author?.imageUrl,
            };
          })
        );

        return {
          ...base,
          kind: "recentMessages" as const,
          channel: { id: channel._id, name: channel.name },
          // Oldest first, so the card reads like a conversation rather than
          // like a feed.
          messages: messages.reverse(),
        };
      })
    );

    return resolved.filter((w): w is NonNullable<typeof w> => w !== null);
  },
});

/** The raw rows, for the editor — unresolved and unfiltered, because the
 * person arranging the dashboard has to be able to see a card even while it
 * points at a channel nobody else can read. */
export const listForEditing = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const community = await ctx.db.get(communityId);
    if (!community) return [];
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    const rows = await widgetsOf(ctx, communityId);
    return rows.map((w) => ({
      id: w._id,
      position: w.position,
      title: w.title,
      width: w.width ?? "half",
      config: w.config,
    }));
  },
});

export const generateWidgetUploadUrl = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    return ctx.storage.generateUploadUrl();
  },
});

export const upsertWidget = mutation({
  args: {
    communityId: v.id("communities"),
    widgetId: v.optional(v.id("communityWidgets")),
    title: v.optional(v.string()),
    width: v.optional(v.union(v.literal("half"), v.literal("full"))),
    config: configValidator,
    /** A freshly uploaded banner image, adopted into the config here so the
     * client never has to hold a storage URL. */
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, args.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);

    let config = args.config;
    if (args.imageStorageId && config.kind === "banner") {
      await requireWithinUploadLimit(
        ctx,
        args.imageStorageId,
        MAX_PROFILE_ASSET_BYTES,
        "Overview banners"
      );
      const url = await ctx.storage.getUrl(args.imageStorageId);
      if (!url) throw new Error("Banner upload failed.");
      config = { ...config, imageUrl: url, imageStorageId: args.imageStorageId };
    }

    const patch = {
      title: args.title?.trim().slice(0, 80) || undefined,
      width: args.width ?? "half",
      config,
    };

    if (args.widgetId) {
      const existing = await ctx.db.get(args.widgetId);
      if (!existing || existing.communityId !== args.communityId) {
        throw new Error("That widget isn't on this server.");
      }
      await ctx.db.patch(args.widgetId, patch);
      // The picture the edit replaced, if any.
      if (
        existing.config.kind === "banner" &&
        existing.config.imageStorageId &&
        existing.config.imageStorageId !== args.imageStorageId
      ) {
        await ctx.storage.delete(existing.config.imageStorageId).catch(() => {});
      }
      return args.widgetId;
    }

    const siblings = await widgetsOf(ctx, args.communityId);
    if (siblings.length >= MAX_WIDGETS) {
      throw new Error(`An overview holds up to ${MAX_WIDGETS} cards.`);
    }
    return ctx.db.insert("communityWidgets", {
      communityId: args.communityId,
      position: siblings.length,
      ...patch,
    });
  },
});

export const removeWidget = mutation({
  args: { widgetId: v.id("communityWidgets") },
  handler: async (ctx, { widgetId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const widget = await ctx.db.get(widgetId);
    if (!widget) return;
    const community = await requireCommunity(ctx, widget.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    await ctx.db.delete(widgetId);
    if (widget.config.kind === "banner" && widget.config.imageStorageId) {
      await ctx.storage.delete(widget.config.imageStorageId).catch(() => {});
    }
  },
});

/** Takes the whole order, like the profile board's — the client's drag result
 * is what lands, with no second interpretation of it here. */
export const reorderWidgets = mutation({
  args: {
    communityId: v.id("communities"),
    widgetIds: v.array(v.id("communityWidgets")),
  },
  handler: async (ctx, { communityId, widgetIds }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    let position = 0;
    for (const id of widgetIds) {
      const widget = await ctx.db.get(id);
      if (!widget || widget.communityId !== communityId) continue;
      await ctx.db.patch(id, { position: position++ });
    }
  },
});

/** Whether this member may rearrange the overview — the client uses it to
 * decide whether to offer the editor at all. */
export const canEditOverview = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return false;
    const community = await ctx.db.get(communityId);
    if (!community) return false;
    try {
      await requireMember(ctx, communityId, me._id);
      await requireCommunityPermission(
        ctx,
        community,
        me._id,
        PERMISSIONS.MANAGE_COMMUNITY
      );
      return true;
    } catch {
      return false;
    }
  },
});
