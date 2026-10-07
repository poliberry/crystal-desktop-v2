import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { freshToken } from "./connectedAccounts";
import { requireCommunity, requireMember } from "./communities";
import { PLATFORM_META, type CreatorPlatform } from "./lib/communityKinds";
import { PLATFORMS, type Tier } from "./lib/platforms";
import { DEFAULT_EVERYONE_PERMISSIONS, PERMISSIONS, can, getBasePermissions, requireCommunityPermission } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * What a creator community adds: a link to the creator's channel on a platform, a
 * feed of what they have put out, the platform's membership tiers as roles, and —
 * for a members-only community — the check that a person really is one.
 */

const FEED_KEEP = 60;
const SYNC_COOLDOWN_MS = 60_000;
/** How long a verified membership is trusted before it is asked again. */
const MEMBERSHIP_TTL_MS = 24 * 60 * 60 * 1000;
const TIER_COLOURS = ["#94a3b8", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#f59e0b"];

const urlOf = (provider: CreatorPlatform, handle: string | undefined, externalId: string): string | undefined => {
  switch (provider) {
    case "twitch":
      return handle ? `https://twitch.tv/${handle}` : undefined;
    case "youtube":
      return handle ? `https://youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}` : `https://youtube.com/channel/${externalId}`;
    case "tiktok":
      return handle ? `https://tiktok.com/@${handle}` : undefined;
  }
};

// --- Reading ---------------------------------------------------------------------------------

export const overview = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const community = await requireCommunity(ctx, communityId);
    if (community.kind !== "creator") throw new Error("That isn't a creator community.");
    const canManage = can(await getBasePermissions(ctx, community, me._id), PERMISSIONS.MANAGE_COMMUNITY);

    const channel = await ctx.db
      .query("creatorChannels")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .unique();
    const tiers = await ctx.db
      .query("creatorTiers")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const membership = await ctx.db
      .query("creatorMemberships")
      .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", me._id))
      .unique();
    return {
      canManage,
      platform: community.creatorPlatform ?? null,
      audience: community.creatorAudience ?? "public",
      channel: channel
        ? {
            id: channel._id,
            provider: channel.provider,
            name: channel.name,
            avatarUrl: channel.avatarUrl,
            url: channel.url,
            isLive: channel.isLive,
            liveTitle: channel.liveTitle,
            lastSyncAt: channel.lastSyncAt,
            // The sync's own failures are for whoever runs the community.
            lastSyncError: canManage ? channel.lastSyncError : undefined,
          }
        : null,
      tiers: tiers.sort((a, b) => a.rank - b.rank).map((t) => ({ key: t.tierKey, name: t.name, roleId: t.roleId })),
      membership: membership ? { tierKey: membership.tierKey ?? null, checkedAt: membership.checkedAt } : null,
    };
  },
});

export const feed = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const items = await ctx.db
      .query("creatorFeedItems")
      .withIndex("by_community_published", (q) => q.eq("communityId", communityId))
      .order("desc")
      .take(40);
    const channel = await ctx.db.query("creatorChannels").withIndex("by_community", (q) => q.eq("communityId", communityId)).unique();
    return {
      live: channel?.isLive ? { title: channel.liveTitle ?? "Live now", url: channel.url, since: channel.liveSince } : null,
      linked: channel !== null,
      items: items.map((i) => ({
        id: i._id,
        kind: i.kind,
        title: i.title,
        thumbnailUrl: i.thumbnailUrl,
        url: i.url,
        durationSeconds: i.durationSeconds,
        views: i.views,
        publishedAt: i.publishedAt,
        provider: i.provider,
      })),
    };
  },
});

// --- Linking the channel -------------------------------------------------------------------

/** Centre the community on one of the caller's connected channel accounts. */
export const linkChannel = mutation({
  args: { communityId: v.id("communities"), accountId: v.id("connectedAccounts") },
  handler: async (ctx, { communityId, accountId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    if (community.kind !== "creator") throw new Error("That isn't a creator community.");
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    const account = await ctx.db.get(accountId);
    if (!account || account.userId !== me._id) throw new Error("That isn't one of your accounts.");
    if (community.creatorPlatform && community.creatorPlatform !== account.provider) {
      throw new Error(`This community is set up for ${PLATFORM_META[community.creatorPlatform].label}.`);
    }

    const existing = await ctx.db.query("creatorChannels").withIndex("by_community", (q) => q.eq("communityId", communityId)).unique();
    const fields = {
      accountId,
      provider: account.provider,
      channelId: account.externalId,
      name: account.displayName,
      avatarUrl: account.avatarUrl,
      url: urlOf(account.provider, account.handle, account.externalId),
    };
    const id = existing
      ? (await ctx.db.patch(existing._id, { ...fields, lastSyncError: undefined }), existing._id)
      : await ctx.db.insert("creatorChannels", { communityId, ...fields, isLive: false, createdAt: Date.now() });
    if (!community.creatorPlatform) await ctx.db.patch(communityId, { creatorPlatform: account.provider });
    await ctx.scheduler.runAfter(0, internal.creatorCommunities.syncChannel, { creatorChannelId: id });
    return id;
  },
});

export const unlinkChannel = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    const channel = await ctx.db.query("creatorChannels").withIndex("by_community", (q) => q.eq("communityId", communityId)).unique();
    if (!channel) return;
    for (const item of await ctx.db.query("creatorFeedItems").withIndex("by_community_published", (q) => q.eq("communityId", communityId)).collect()) {
      await ctx.db.delete(item._id);
    }
    await ctx.db.delete(channel._id);
  },
});

// --- Syncing the feed ----------------------------------------------------------------------

export const channelForSync = internalQuery({
  args: { creatorChannelId: v.id("creatorChannels") },
  handler: async (ctx, { creatorChannelId }) => ctx.db.get(creatorChannelId),
});

export const applyFeed = internalMutation({
  args: {
    creatorChannelId: v.id("creatorChannels"),
    live: v.object({ isLive: v.boolean(), title: v.optional(v.string()), since: v.optional(v.number()) }),
    items: v.array(
      v.object({
        externalId: v.string(),
        kind: v.union(v.literal("live"), v.literal("vod"), v.literal("upload"), v.literal("short")),
        title: v.string(),
        thumbnailUrl: v.optional(v.string()),
        url: v.string(),
        durationSeconds: v.optional(v.number()),
        views: v.optional(v.number()),
        publishedAt: v.number(),
      }),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { creatorChannelId, live, items, error }) => {
    const channel = await ctx.db.get(creatorChannelId);
    if (!channel) return;
    const now = Date.now();
    if (error) {
      await ctx.db.patch(creatorChannelId, { lastSyncError: error.slice(0, 200), lastSyncAt: now });
      return;
    }
    const wasLive = channel.isLive;
    await ctx.db.patch(creatorChannelId, {
      isLive: live.isLive,
      liveTitle: live.isLive ? live.title : undefined,
      liveSince: live.isLive ? live.since : undefined,
      lastSyncAt: now,
      lastSyncError: undefined,
    });
    // A live entry is only the "now" of a stream that will turn into a VOD with
    // an id of its own: it is shown, not kept, so it can't linger once it ends.
    for (const old of await ctx.db
      .query("creatorFeedItems")
      .withIndex("by_community_published", (q) => q.eq("communityId", channel.communityId))
      .collect()) {
      if (old.kind === "live") await ctx.db.delete(old._id);
    }
    for (const item of items) {
      const existing = await ctx.db
        .query("creatorFeedItems")
        .withIndex("by_community_external", (q) => q.eq("communityId", channel.communityId).eq("externalId", item.externalId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, { ...item, provider: channel.provider });
      else await ctx.db.insert("creatorFeedItems", { ...item, communityId: channel.communityId, provider: channel.provider });
    }
    // Keep a bounded window.
    const all = await ctx.db
      .query("creatorFeedItems")
      .withIndex("by_community_published", (q) => q.eq("communityId", channel.communityId))
      .order("desc")
      .collect();
    for (const extra of all.slice(FEED_KEEP)) await ctx.db.delete(extra._id);
    void wasLive;
  },
});

export const syncChannel = internalAction({
  args: { creatorChannelId: v.id("creatorChannels") },
  handler: async (ctx, { creatorChannelId }): Promise<void> => {
    const channel: Doc<"creatorChannels"> | null = await ctx.runQuery(internal.creatorCommunities.channelForSync, { creatorChannelId });
    if (!channel) return;
    try {
      const { token, account } = await freshToken(ctx, channel.accountId);
      const platform = PLATFORMS[channel.provider];
      const result = await platform.feed(token, {
        externalId: channel.channelId,
        displayName: channel.name,
        handle: account.handle,
        url: channel.url,
      });
      await ctx.runMutation(internal.creatorCommunities.applyFeed, { creatorChannelId, live: result.live, items: result.items });
    } catch (e) {
      await ctx.runMutation(internal.creatorCommunities.applyFeed, {
        creatorChannelId,
        live: { isLive: false },
        items: [],
        error: e instanceof Error ? e.message : "Couldn't update the feed.",
      });
    }
  },
});

/** Update every linked channel's feed. Run on a timer. */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const ids: Id<"creatorChannels">[] = await ctx.runQuery(internal.creatorCommunities.allChannelIds, {});
    // Spread over the interval rather than all at once: each is several platform calls.
    for (const [i, id] of ids.entries()) await ctx.scheduler.runAfter(i * 1500, internal.creatorCommunities.syncChannel, { creatorChannelId: id });
  },
});

export const allChannelIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("creatorChannels").take(300)).map((c) => c._id),
});

/** Refresh now, for a manager who has just posted or just connected. */
export const syncNow = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    const channel = await ctx.db.query("creatorChannels").withIndex("by_community", (q) => q.eq("communityId", communityId)).unique();
    if (!channel) throw new Error("Link a channel first.");
    if (channel.lastSyncAt && Date.now() - channel.lastSyncAt < SYNC_COOLDOWN_MS) throw new Error("It was only just updated.");
    await ctx.scheduler.runAfter(0, internal.creatorCommunities.syncChannel, { creatorChannelId: channel._id });
  },
});

// --- Tiers as roles --------------------------------------------------------------------------

export const applyTiers = internalMutation({
  args: {
    communityId: v.id("communities"),
    tiers: v.array(v.object({ key: v.string(), name: v.string(), rank: v.number() })),
  },
  handler: async (ctx, { communityId, tiers }) => {
    const existing = await ctx.db.query("creatorTiers").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
    const byKey = new Map(existing.map((t) => [t.tierKey, t]));
    const fresh = tiers.filter((t) => !byKey.has(t.key));

    // New tier roles go just above @everyone and below every role the community
    // already has, so importing tiers can never outrank its moderators.
    if (fresh.length > 0) {
      const roles = (await ctx.db.query("roles").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect()).filter((r) => !r.isEveryone);
      for (const role of roles) await ctx.db.patch(role._id, { position: role.position + fresh.length });
    }
    let slot = 1;
    for (const tier of [...tiers].sort((a, b) => a.rank - b.rank)) {
      const known = byKey.get(tier.key);
      if (known) {
        await ctx.db.patch(known._id, { name: tier.name, rank: tier.rank });
        const role = await ctx.db.get(known.roleId);
        if (role && role.name !== tier.name) await ctx.db.patch(role._id, { name: tier.name });
        continue;
      }
      const roleId = await ctx.db.insert("roles", {
        communityId,
        name: tier.name,
        color: TIER_COLOURS[(tier.rank - 1) % TIER_COLOURS.length],
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        position: slot++,
        isEveryone: false,
        hoist: true,
      });
      await ctx.db.insert("creatorTiers", { communityId, tierKey: tier.key, name: tier.name, rank: tier.rank, roleId });
    }
    return fresh.length;
  },
});

/** Import the platform's tiers as roles. Safe to run again: new tiers are added,
 * existing ones are renamed, and none are deleted. */
export const importTiers = action({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }): Promise<{ added: number; total: number }> => {
    const info: { accountId: Id<"connectedAccounts">; provider: CreatorPlatform } = await ctx.runQuery(internal.creatorCommunities.manageContext, { communityId });
    const platform = PLATFORMS[info.provider];
    const { token, account } = await freshToken(ctx, info.accountId);
    const canRead = info.provider === "twitch" ? account.scopes.includes("channel:read:subscriptions") : account.scopes.some((s) => s.includes("channel-memberships"));
    if (!canRead) throw new Error("Connect your channel again and allow Crystal to see your members.");
    let tiers: Tier[];
    try {
      tiers = await platform.tiers(token);
    } catch {
      throw new Error("Couldn't read your tiers from the platform.");
    }
    if (tiers.length === 0) throw new Error(info.provider === "twitch" ? "You need to be a Twitch Affiliate or Partner to have subscriber tiers." : "No membership levels found on that channel.");
    const added: number = await ctx.runMutation(internal.creatorCommunities.applyTiers, { communityId, tiers });
    return { added, total: tiers.length };
  },
});

export const manageContext = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    if (community.kind !== "creator") throw new Error("That isn't a creator community.");
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    const channel = await ctx.db.query("creatorChannels").withIndex("by_community", (q) => q.eq("communityId", communityId)).unique();
    if (!channel) throw new Error("Link a channel first.");
    return { accountId: channel.accountId, provider: channel.provider };
  },
});

// --- Who is a member -------------------------------------------------------------------------

/** What `verify` needs to know, for one person in one community. */
export const verifyContext = internalQuery({
  args: { communityId: v.id("communities"), userId: v.id("users") },
  handler: async (ctx, { communityId, userId }) => {
    const channel = await ctx.db.query("creatorChannels").withIndex("by_community", (q) => q.eq("communityId", communityId)).unique();
    if (!channel) return null;
    const accounts = await ctx.db.query("connectedAccounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const theirs = accounts.find((a) => a.provider === channel.provider) ?? null;
    return { channel, theirAccount: theirs };
  },
});

/** Record what a person is on the platform and give them the matching role. */
export const applyMembership = internalMutation({
  args: { communityId: v.id("communities"), userId: v.id("users"), tierKey: v.optional(v.string()) },
  handler: async (ctx, { communityId, userId, tierKey }) => {
    await recordMembership(ctx, communityId, userId, tierKey);
  },
});

async function recordMembership(ctx: MutationCtx, communityId: Id<"communities">, userId: Id<"users">, tierKey: string | undefined) {
  const now = Date.now();
  const row = await ctx.db.query("creatorMemberships").withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", userId)).unique();
  if (row) await ctx.db.patch(row._id, { tierKey, checkedAt: now });
  else await ctx.db.insert("creatorMemberships", { communityId, userId, tierKey, checkedAt: now });

  // Only someone who is already in the community has roles to change.
  const member = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", userId)).unique();
  if (!member) return;
  const tiers = await ctx.db.query("creatorTiers").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
  const tierRoleIds = new Set(tiers.map((t) => t.roleId as string));
  const wanted = tiers.find((t) => t.tierKey === tierKey)?.roleId;
  const held = await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId)).collect();
  for (const h of held) if (tierRoleIds.has(h.roleId as string) && h.roleId !== wanted) await ctx.db.delete(h._id);
  if (wanted && !held.some((h) => h.roleId === wanted)) await ctx.db.insert("memberRoles", { communityId, userId, roleId: wanted });
}

async function verify(
  ctx: { runQuery: any; runMutation: any },
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<{ checked: boolean; tierKey: string | null; reason?: string }> {
  const info: { channel: Doc<"creatorChannels">; theirAccount: Doc<"connectedAccounts"> | null } | null = await ctx.runQuery(
    internal.creatorCommunities.verifyContext,
    { communityId, userId },
  );
  if (!info) return { checked: false, tierKey: null, reason: "This community hasn't linked a channel yet." };
  const platform = PLATFORMS[info.channel.provider];
  if (!platform.tierOf) return { checked: false, tierKey: null, reason: `${PLATFORM_META[info.channel.provider].label} has no memberships to check.` };
  if (!info.theirAccount) return { checked: false, tierKey: null, reason: `Connect your ${PLATFORM_META[info.channel.provider].label} account first.` };
  const creatorAccount: Doc<"connectedAccounts"> = (await ctx.runQuery(internal.connectedAccounts.cipherFor, { accountId: info.channel.accountId }))!;
  const { token } = await freshToken(ctx as never, creatorAccount._id);
  const tier = await platform.tierOf(
    token,
    { externalId: info.channel.channelId, displayName: info.channel.name },
    info.theirAccount.externalId,
  );
  await ctx.runMutation(internal.creatorCommunities.applyMembership, { communityId, userId, tierKey: tier ?? undefined });
  return { checked: true, tierKey: tier };
}

/** Ask the platform whether the caller is a member, and record the answer — the
 * step before joining a members-only community, and a way to refresh your role. */
export const verifyMembership = action({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }): Promise<{ checked: boolean; member: boolean; tierName?: string; reason?: string }> => {
    const userId: Id<"users"> = await ctx.runQuery(internal.connectedAccounts.whoami, {});
    try {
      const r = await verify(ctx, communityId, userId);
      const tiers: { key: string; name: string }[] = (await ctx.runQuery(internal.creatorCommunities.tierNames, { communityId })) ?? [];
      return { checked: r.checked, member: r.tierKey !== null, tierName: tiers.find((t) => t.key === r.tierKey)?.name, reason: r.reason };
    } catch (e) {
      return { checked: false, member: false, reason: e instanceof Error ? e.message : "Couldn't check right now." };
    }
  },
});

export const tierNames = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) =>
    (await ctx.db.query("creatorTiers").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect()).map((t) => ({ key: t.tierKey, name: t.name })),
});

/** Re-check people whose membership hasn't been looked at lately, a few at a time. */
export const resyncMemberships = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const stale: { communityId: Id<"communities">; userId: Id<"users"> }[] = await ctx.runQuery(internal.creatorCommunities.staleMemberships, {});
    for (const [i, row] of stale.entries()) await ctx.scheduler.runAfter(i * 2000, internal.creatorCommunities.resyncOne, row);
  },
});

export const staleMemberships = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MEMBERSHIP_TTL_MS;
    const rows = await ctx.db.query("creatorMemberships").take(500);
    return rows.filter((r) => r.checkedAt < cutoff).slice(0, 60).map((r) => ({ communityId: r.communityId, userId: r.userId }));
  },
});

export const resyncOne = internalAction({
  args: { communityId: v.id("communities"), userId: v.id("users") },
  handler: async (ctx, { communityId, userId }): Promise<void> => {
    try {
      await verify(ctx, communityId, userId);
    } catch {
      // A platform that is down is not a reason to take anyone's role away.
    }
  },
});

// --- Joining with an invite ----------------------------------------------------------------

export const communityByInvite = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const community = await ctx.db.query("communities").withIndex("by_invite_code", (q) => q.eq("inviteCode", code)).unique();
    if (!community || community.kind !== "creator") return null;
    return { id: community._id, name: community.name, platform: community.creatorPlatform ?? null, audience: community.creatorAudience ?? "public" };
  },
});

/** What a members-only invite needs from the person, so the dialog can say so. */
export const inviteRequirement = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ communityName: string; platform: CreatorPlatform | null } | null> => {
    const info: { id: Id<"communities">; name: string; platform: CreatorPlatform | null; audience: string } | null = await ctx.runQuery(
      internal.creatorCommunities.communityByInvite,
      { code },
    );
    return info ? { communityName: info.name, platform: info.platform } : null;
  },
});

/** Check the caller against the platform for the community an invite leads to. */
export const verifyForInvite = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ member: boolean; reason?: string }> => {
    const info: { id: Id<"communities">; name: string; platform: CreatorPlatform | null; audience: string } | null = await ctx.runQuery(
      internal.creatorCommunities.communityByInvite,
      { code },
    );
    if (!info) return { member: false, reason: "That invite doesn't lead to a creator community." };
    const userId: Id<"users"> = await ctx.runQuery(internal.connectedAccounts.whoami, {});
    try {
      const r = await verify(ctx, info.id, userId);
      return { member: r.tierKey !== null, reason: r.tierKey === null ? (r.reason ?? "The platform doesn't list you as a member.") : undefined };
    } catch (e) {
      return { member: false, reason: e instanceof Error ? e.message : "Couldn't check right now." };
    }
  },
});
