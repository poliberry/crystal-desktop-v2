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
import { isR2Url, dropR2Url, r2PublicUrlForKey } from "./lib/r2";

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
  v.object({
    kind: v.literal("rules"),
    rules: v.array(v.object({ title: v.string(), body: v.optional(v.string()) })),
  }),
  v.object({
    kind: v.literal("note"),
    body: v.string(),
    color: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("countdown"),
    target: v.number(),
    description: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("calendar"),
    events: v.array(v.object({ date: v.string(), title: v.string() })),
  }),
  v.object({
    kind: v.literal("poll"),
    question: v.string(),
    options: v.array(v.string()),
    closesAt: v.optional(v.number()),
  }),
);

/** The post-it colours; anything else is the default yellow. */
export const NOTE_COLORS = ["yellow", "pink", "blue", "green", "orange"] as const;
const MAX_POLL_OPTIONS = 8;
const MAX_CALENDAR_EVENTS = 50;

/** The limits on what the newer kinds hold, applied to what a client sent. */
function sanitizeConfig<C extends { kind: string }>(config: C): C {
  const cfg = config as any;
  switch (cfg.kind) {
    case "note":
      return {
        ...cfg,
        body: String(cfg.body).slice(0, 500),
        color: NOTE_COLORS.includes(cfg.color) ? cfg.color : "yellow",
      };
    case "countdown":
      return { ...cfg, description: cfg.description?.trim().slice(0, 160) || undefined };
    case "calendar":
      return {
        ...cfg,
        events: (cfg.events as { date: string; title: string }[])
          .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title.trim())
          .slice(0, MAX_CALENDAR_EVENTS)
          .map((e) => ({ date: e.date, title: e.title.trim().slice(0, 80) })),
      };
    case "poll": {
      const options = (cfg.options as string[])
        .map((o) => o.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, MAX_POLL_OPTIONS);
      return { ...cfg, question: String(cfg.question).trim().slice(0, 160), options };
    }
    default:
      return config;
  }
}

const layoutValidator = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
});

/** The twelve-column grid (src/lib/overview-layout.ts), enforced here because
 * the numbers come from a client. */
function sanitizeLayout(layout: { x: number; y: number; w: number; h: number }) {
  const w = Math.min(12, Math.max(1, Math.round(layout.w)));
  return {
    w,
    h: Math.min(40, Math.max(1, Math.round(layout.h))),
    x: Math.min(12 - w, Math.max(0, Math.round(layout.x))),
    y: Math.min(400, Math.max(0, Math.round(layout.y))),
  };
}

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
          layout: widget.layout,
        };
        const config = widget.config;

        if (config.kind === "markdown") {
          return { ...base, kind: "markdown" as const, body: config.body };
        }

        if (config.kind === "note") {
          // Written by the owner, whoever that is now.
          const owner = await ctx.db.get(community.ownerId);
          return {
            ...base,
            kind: "note" as const,
            body: config.body,
            color: config.color ?? "yellow",
            author: { name: owner?.name ?? "The owner", imageUrl: owner?.imageUrl },
          };
        }

        if (config.kind === "countdown") {
          return {
            ...base,
            kind: "countdown" as const,
            target: config.target,
            description: config.description,
          };
        }

        if (config.kind === "calendar") {
          return { ...base, kind: "calendar" as const, events: config.events };
        }

        if (config.kind === "poll") {
          if (config.options.length < 2) return null;
          const votes = await ctx.db
            .query("communityPollVotes")
            .withIndex("by_widget", (q) => q.eq("widgetId", widget._id))
            .collect();
          const counts = config.options.map(
            (_, index) => votes.filter((vote) => vote.optionIndex === index).length,
          );
          return {
            ...base,
            kind: "poll" as const,
            question: config.question,
            options: config.options.map((label, index) => ({ label, count: counts[index]! })),
            total: counts.reduce((sum, n) => sum + n, 0),
            myVote: votes.find((vote) => vote.userId === me._id)?.optionIndex ?? null,
            closesAt: config.closesAt,
          };
        }

        if (config.kind === "rules") {
          if (config.rules.length === 0) return null;
          return {
            ...base,
            title: widget.title ?? "Rules",
            kind: "rules" as const,
            rules: config.rules,
          };
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
      layout: w.layout,
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
    /** Where a new card goes. Left out when editing one, so changing what a
     * card says never moves it. */
    layout: v.optional(layoutValidator),
    /** A freshly uploaded banner image, adopted into the config here so the
     * client never has to hold a storage URL. */
    imageStorageId: v.optional(v.id("_storage")),
    /** The same image, uploaded to the CDN instead of Convex storage. */
    imageCdnKey: v.optional(v.string()),
    imageCdnUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, args.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);

    let config = sanitizeConfig(args.config);
    if ((args.imageCdnKey || args.imageCdnUrl) && config.kind === "banner") {
      const url = args.imageCdnUrl ?? r2PublicUrlForKey(args.imageCdnKey!);
      if (!url) throw new Error("Banner upload failed.");
      config = { ...config, imageUrl: url, imageStorageId: undefined };
    }
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

    const layout = args.layout ? sanitizeLayout(args.layout) : undefined;
    const patch = {
      title: args.title?.trim().slice(0, 80) || undefined,
      // Kept for the sake of readers that predate `layout`; with one, the size
      // on the board decides.
      width: layout ? (layout.w >= 9 ? ("full" as const) : ("half" as const)) : (args.width ?? "half"),
      config,
      ...(layout ? { layout } : {}),
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
      // The CDN picture it replaced, if the edit gave it a new one.
      if (
        existing.config.kind === "banner" &&
        existing.config.imageUrl &&
        isR2Url(existing.config.imageUrl) &&
        patch.config.kind === "banner" &&
        patch.config.imageUrl !== existing.config.imageUrl &&
        (args.imageStorageId || args.imageCdnKey || args.imageCdnUrl)
      ) {
        await dropR2Url(ctx, existing.config.imageUrl).catch(() => {});
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
    if (widget.config.kind === "poll") {
      const votes = await ctx.db
        .query("communityPollVotes")
        .withIndex("by_widget", (q) => q.eq("widgetId", widgetId))
        .collect();
      for (const vote of votes) await ctx.db.delete(vote._id);
    }
    if (widget.config.kind === "banner" && widget.config.imageStorageId) {
      await ctx.storage.delete(widget.config.imageStorageId).catch(() => {});
    }
    if (widget.config.kind === "banner" && widget.config.imageUrl && isR2Url(widget.config.imageUrl)) {
      await dropR2Url(ctx, widget.config.imageUrl).catch(() => {});
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

/** Where every card sits, in one write — what comes out of a drag or a resize
 * on the pinboard. The reading order is rewritten to match, so anything that
 * lays the cards out in a column (a narrow window) reads them the way the board
 * does: top to bottom, left to right. */
export const saveLayout = mutation({
  args: {
    communityId: v.id("communities"),
    items: v.array(v.object({ id: v.id("communityWidgets"), ...layoutValidator.fields })),
  },
  handler: async (ctx, { communityId, items }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);

    const cleaned = items.map((item) => ({ id: item.id, ...sanitizeLayout(item) }));
    cleaned.sort((a, b) => a.y - b.y || a.x - b.x);
    let position = 0;
    for (const item of cleaned) {
      const widget = await ctx.db.get(item.id);
      if (!widget || widget.communityId !== communityId) continue;
      const { id, ...layout } = item;
      await ctx.db.patch(id, {
        layout,
        width: layout.w >= 9 ? "full" : "half",
        position: position++,
      });
    }
  },
});

/**
 * Votes on a poll card, or takes the vote back (`optionIndex: null`).
 *
 * Any member may vote; one vote each, and voting again moves it. Checked here
 * rather than trusted from the card: whether the poll has closed, whether the
 * option exists, and whether the voter is in the community at all.
 */
export const votePoll = mutation({
  args: {
    widgetId: v.id("communityWidgets"),
    optionIndex: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { widgetId, optionIndex }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const widget = await ctx.db.get(widgetId);
    if (!widget || widget.config.kind !== "poll") throw new Error("That isn't a poll.");
    await requireMember(ctx, widget.communityId, me._id);

    const config = widget.config;
    if (config.closesAt !== undefined && Date.now() >= config.closesAt) {
      throw new Error("This poll has closed.");
    }

    const existing = await ctx.db
      .query("communityPollVotes")
      .withIndex("by_widget_user", (q) => q.eq("widgetId", widgetId).eq("userId", me._id))
      .unique();

    if (optionIndex === null) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= config.options.length) {
      throw new Error("That isn't one of the options.");
    }
    if (existing) await ctx.db.patch(existing._id, { optionIndex });
    else {
      await ctx.db.insert("communityPollVotes", {
        widgetId,
        communityId: widget.communityId,
        userId: me._id,
        optionIndex,
      });
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
