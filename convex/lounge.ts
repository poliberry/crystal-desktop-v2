import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import { isActive } from "./lib/entitlements";
import { normalizeSceneSpec } from "./lib/creationSpecs";
import { isLoungeStickerId } from "./lib/loungeStickers";
import { PERMISSIONS, requireCommunityPermission } from "./permissions";
import { MAX_ATTACHMENT_BYTES } from "./uploadLimits";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * A lounge's chat, topic and scene.
 *
 * Who is where in the room, and who is moving, is not here: that is a stream of
 * tiny packets between the people in the call (LiveKit data messages), too fast
 * and too throwaway for a database. What is here is what should be the same for
 * everybody and survive a reload — what was said, and what the room is about.
 */

const MAX_TEXT = 300;
const MAX_TOPIC = 80;
const HISTORY = 80;
const TOPIC_COOLDOWN_MS = 3000;
const MIN_GAP_MS = 350;
/** What is said in an empty lounge is forgotten; this is how much one pass of
 * the clean-up deletes before it asks to run again. */
const PURGE_BATCH = 200;

async function loungeOf(ctx: QueryCtx, channelId: Id<"channels">): Promise<Doc<"channels">> {
  const channel = await ctx.db.get(channelId);
  if (!channel || !channel.isLounge) throw new Error("That isn't a lounge.");
  return channel;
}

/** Whether somebody is in the lounge's call right now. Saying something, or
 * changing the topic, needs it: a lounge is for the people in it. */
async function isInCall(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">) {
  const row = await ctx.db
    .query("channelCallParticipants")
    .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
    .unique();
  return !!row;
}

/** The chat so far, oldest first, with who said what. */
export const messages = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const channel = await ctx.db.get(channelId);
    if (!channel?.isLounge) return [];
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", me._id))
      .unique();
    if (!membership) return [];

    const rows = (
      await ctx.db
        .query("loungeMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .order("desc")
        .take(HISTORY)
    ).reverse();

    const emojiById = new Map<string, string>();
    return Promise.all(
      rows.map(async (m) => {
        let sticker: { source: "builtin" | "emoji"; id: string; imageUrl?: string } | undefined;
        if (m.sticker) {
          sticker = { ...m.sticker };
          if (m.sticker.source === "emoji") {
            if (!emojiById.has(m.sticker.id)) {
              const emoji = await ctx.db.get(m.sticker.id as Id<"communityEmojis">).catch(() => null);
              emojiById.set(m.sticker.id, emoji?.imageUrl ?? "");
            }
            sticker.imageUrl = emojiById.get(m.sticker.id) || undefined;
          }
        }
        const imageUrl = m.image
          ? (m.image.cdnUrl ?? (m.image.storageId ? await ctx.storage.getUrl(m.image.storageId) : null) ?? undefined)
          : undefined;
        return {
          id: m._id,
          authorId: m.authorId,
          kind: m.kind,
          text: m.text,
          emoji: m.emoji,
          sticker,
          imageUrl,
          createdAt: m.createdAt,
        };
      }),
    );
  },
});

export const generateUploadUrl = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await loungeOf(ctx, channelId);
    if (!(await isInCall(ctx, channelId, me._id))) throw new Error("Join the lounge first.");
    return ctx.storage.generateUploadUrl();
  },
});

/** Say something: some text, a picture, an emoji that floats up, or a sticker. */
export const send = mutation({
  args: {
    channelId: v.id("channels"),
    kind: v.union(v.literal("text"), v.literal("image"), v.literal("emoji"), v.literal("sticker")),
    text: v.optional(v.string()),
    emoji: v.optional(v.string()),
    sticker: v.optional(v.object({ source: v.union(v.literal("builtin"), v.literal("emoji")), id: v.string() })),
    image: v.optional(
      v.object({
        storageId: v.optional(v.id("_storage")),
        cdnUrl: v.optional(v.string()),
        cdnKey: v.optional(v.string()),
        fileName: v.string(),
        fileType: v.string(),
        fileSize: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await loungeOf(ctx, args.channelId);
    await requireMember(ctx, channel.communityId, me._id);
    if (!(await isInCall(ctx, args.channelId, me._id))) throw new Error("Join the lounge to say something.");

    // A little pause between messages: this is a room, not a firehose, and every
    // message animates on every screen.
    const last = await ctx.db
      .query("loungeMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .take(5);
    const now = Date.now();
    if (last.some((m) => m.authorId === me._id && now - m.createdAt < MIN_GAP_MS)) {
      throw new Error("Slow down a little.");
    }

    const base = { channelId: args.channelId, authorId: me._id, kind: args.kind, createdAt: now };

    if (args.kind === "text") {
      const text = (args.text ?? "").trim();
      if (!text) throw new Error("Write something first.");
      return ctx.db.insert("loungeMessages", { ...base, text: text.slice(0, MAX_TEXT) });
    }

    if (args.kind === "emoji") {
      const emoji = (args.emoji ?? "").trim();
      // A unicode emoji or a `<:name:id>` custom one — and nothing else, so this
      // can't be used to float arbitrary text.
      const custom = /^<:[a-zA-Z0-9_]+:[a-zA-Z0-9]+>$/.test(emoji);
      const unicode = emoji.length <= 24 && /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️|⃣|[\u{1F3FB}-\u{1F3FF}]|[0-9#*])+$/u.test(emoji) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(emoji);
      if (!custom && !unicode) throw new Error("That isn't an emoji.");
      return ctx.db.insert("loungeMessages", { ...base, emoji });
    }

    if (args.kind === "sticker") {
      const sticker = args.sticker;
      if (!sticker) throw new Error("Pick a sticker.");
      if (sticker.source === "builtin") {
        if (!isLoungeStickerId(sticker.id)) throw new Error("That sticker doesn't exist.");
      } else {
        const emoji = await ctx.db.get(sticker.id as Id<"communityEmojis">).catch(() => null);
        if (!emoji || emoji.communityId !== channel.communityId) throw new Error("That sticker isn't from here.");
      }
      return ctx.db.insert("loungeMessages", { ...base, sticker });
    }

    const image = args.image;
    if (!image) throw new Error("Pick a picture.");
    if (!image.fileType.startsWith("image/") || image.fileType === "image/svg+xml") {
      throw new Error("Only pictures can be sent here.");
    }
    if (image.fileSize > MAX_ATTACHMENT_BYTES) throw new Error("That picture is too big.");
    if (!image.storageId && !image.cdnUrl) throw new Error("The upload didn't finish.");
    const cdnBase = (process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "").replace(/\/$/, "");
    if (image.cdnUrl && (!cdnBase || !image.cdnUrl.startsWith(`${cdnBase}/`))) {
      throw new Error("That picture isn't hosted by Crystal.");
    }
    return ctx.db.insert("loungeMessages", { ...base, image });
  },
});

/** What the room is about, for as long as people are in it. */
export const setTopic = mutation({
  args: { channelId: v.id("channels"), topic: v.string() },
  handler: async (ctx, { channelId, topic }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await loungeOf(ctx, channelId);
    if (!(await isInCall(ctx, channelId, me._id))) throw new Error("Join the lounge to change its topic.");
    const text = topic.trim().slice(0, MAX_TOPIC);
    if (channel.loungeTopicAt && Date.now() - channel.loungeTopicAt < TOPIC_COOLDOWN_MS) {
      throw new Error("The topic was only just changed.");
    }
    await ctx.db.patch(channelId, {
      loungeTopic: text || undefined,
      loungeTopicBy: text ? me._id : undefined,
      loungeTopicAt: Date.now(),
    });
  },
});

// --- Scenes ---------------------------------------------------------------------------

/** The scenes a community owns from the marketplace, for its managers to pick. */
export const ownedScenes = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("entitlements")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .take(100);
    return rows
      .filter((e) => e.kind === "loungeScene" && isActive(e))
      .map((e) => {
        let preview: string | undefined;
        try {
          preview = (JSON.parse(e.payload ?? "") as { backgroundUrl?: string }).backgroundUrl;
        } catch {
          /* no picture to show */
        }
        return { id: e._id, name: e.label ?? "Scene", previewUrl: preview };
      });
  },
});

const BUILTIN_SCENES = ["living-room", "cinema", "beach", "arcade"];

/** Change a lounge's scene: one of the built-in ones, or one the community has
 * bought. */
export const setScene = mutation({
  args: {
    channelId: v.id("channels"),
    scene: v.string(),
    entitlementId: v.optional(v.id("entitlements")),
  },
  handler: async (ctx, { channelId, scene, entitlementId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await loungeOf(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    if (scene !== "custom") {
      if (!BUILTIN_SCENES.includes(scene)) throw new Error("That scene doesn't exist.");
      await ctx.db.patch(channelId, { loungeScene: scene, loungeSceneCustom: undefined });
      return;
    }

    const entitlement = entitlementId ? await ctx.db.get(entitlementId) : null;
    // The scene has to be one this community actually owns and that is still in
    // force — the payload is read from the entitlement, never from the client.
    if (
      !entitlement ||
      entitlement.kind !== "loungeScene" ||
      entitlement.communityId !== channel.communityId ||
      !isActive(entitlement)
    ) {
      throw new Error("This community doesn't have that scene.");
    }
    let spec: ReturnType<typeof normalizeSceneSpec>;
    try {
      // The payload was checked when the scene was approved; this rebuilds it
      // anyway, so what lands on the channel is always a well-formed scene.
      spec = normalizeSceneSpec(
        { name: entitlement.label ?? "Scene", ...(JSON.parse(entitlement.payload ?? "") as object) },
        (url) => url,
      );
    } catch {
      throw new Error("That scene is broken.");
    }
    await ctx.db.patch(channelId, {
      loungeScene: "custom",
      loungeSceneCustom: {
        name: spec.name,
        backgroundUrl: spec.backgroundUrl,
        screen: spec.screen,
        floorTop: spec.floorTop,
        seats: spec.seats,
        props: spec.props,
        lights: spec.lights,
        overlay: spec.overlay,
      },
    });
  },
});

/** An empty lounge forgets: its chat, and what it was about. */
export const reset = internalMutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }): Promise<void> => {
    // Somebody joined again before this ran: nothing to forget yet.
    const someone = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .first();
    if (someone) return;

    const batch = await ctx.db
      .query("loungeMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .take(PURGE_BATCH);
    for (const message of batch) {
      if (message.image?.storageId) await ctx.storage.delete(message.image.storageId).catch(() => {});
      await ctx.db.delete(message._id);
    }
    if (batch.length === PURGE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.lounge.reset, { channelId });
      return;
    }
    const channel = await ctx.db.get(channelId);
    if (channel?.loungeTopic) await ctx.db.patch(channelId, { loungeTopic: undefined, loungeTopicBy: undefined });
  },
});
