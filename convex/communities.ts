import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  PERMISSIONS,
  can,
  getBasePermissions,
  requireAbove,
  requireCommunityPermission,
} from "./permissions";
import { activitiesOf } from "./lib/activities";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

export async function requireMember(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<Doc<"communityMembers">> {
  const membership = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", userId))
    .unique();
  if (!membership) throw new Error("Not a member of this community.");
  return membership;
}

export async function requireCommunity(ctx: QueryCtx, communityId: Id<"communities">): Promise<Doc<"communities">> {
  const community = await ctx.db.get(communityId);
  if (!community) throw new Error("Community not found.");
  return community;
}

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Community name can't be empty.");

    const communityId = await ctx.db.insert("communities", {
      name: trimmed,
      ownerId: me._id,
      createdAt: Date.now(),
    });

    await ctx.db.insert("communityMembers", { communityId, userId: me._id, joinedAt: Date.now() });

    await ctx.db.insert("roles", {
      communityId,
      name: "@everyone",
      permissions: DEFAULT_EVERYONE_PERMISSIONS,
      position: 0,
      isEveryone: true,
    });

    await ctx.db.insert("channels", {
      communityId,
      name: "general",
      type: "text",
      position: 0,
      createdAt: Date.now(),
    });
    await ctx.db.insert("channels", {
      communityId,
      name: "General Voice",
      type: "voice",
      position: 1,
      createdAt: Date.now(),
    });

    return communityId;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const memberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const communities = await Promise.all(memberships.map((m) => ctx.db.get(m.communityId)));
    return communities
      .filter((c): c is Doc<"communities"> => c !== null)
      .map((c) => ({ id: c._id, name: c.name, imageUrl: c.imageUrl, ownerId: c.ownerId }));
  },
});

/** How many faces the rail's tooltip shows before collapsing to "+N". Kept
 * server-side so a busy server doesn't ship a hundred rows for a stack that
 * only ever renders a handful. */
const VOICE_AVATAR_LIMIT = 8;

/**
 * At-a-glance state for every community the user is in: how big it is, and
 * who's currently sitting in any of its voice channels.
 *
 * One query covering all of them rather than one per community, because the
 * rail needs it for all of them at once — it decides which servers get a
 * "call in progress" badge, and fills in the tooltip when one is hovered.
 *
 * Identity follows the usual rule: the member's profile for *this* community
 * where they've set one, falling back to their global profile.
 */
export const listMineActivity = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const memberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    return Promise.all(
      memberships.map(async (membership) => {
        const communityId = membership.communityId;
        const [members, channels] = await Promise.all([
          ctx.db
            .query("communityMembers")
            .withIndex("by_community", (q) => q.eq("communityId", communityId))
            .collect(),
          ctx.db
            .query("channels")
            .withIndex("by_community", (q) => q.eq("communityId", communityId))
            .collect(),
        ]);

        // Deliberately not permission-filtered: this is a count and a set of
        // faces, the same thing the channel list already shows anyone who can
        // see the channel, and hiding a private channel's occupants from the
        // badge would make the badge lie about whether a call is happening.
        const rows = (
          await Promise.all(
            channels
              .filter((channel) => channel.type === "voice")
              .map((channel) =>
                ctx.db
                  .query("channelCallParticipants")
                  .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
                  .collect()
              )
          )
        ).flat();

        const voice = await Promise.all(
          rows.slice(0, VOICE_AVATAR_LIMIT).map(async (row) => {
            const [user, serverProfile] = await Promise.all([
              ctx.db.get(row.userId),
              ctx.db
                .query("serverProfiles")
                .withIndex("by_user_community", (q) =>
                  q.eq("userId", row.userId).eq("communityId", communityId)
                )
                .unique(),
            ]);
            return {
              userId: row.userId,
              name: serverProfile?.displayName ?? user?.name ?? "Unknown",
              imageUrl: serverProfile?.imageUrl ?? user?.imageUrl,
            };
          })
        );

        return {
          communityId,
          memberCount: members.length,
          voice,
          /** Everyone in voice, including those past the avatar limit. */
          voiceCount: rows.length,
        };
      })
    );
  },
});

/** Communities the user hasn't joined yet — every community is open-join for now. */
export const listDiscoverable = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const memberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const joined = new Set(memberships.map((m) => m.communityId));
    const all = await ctx.db.query("communities").collect();
    return all
      .filter((c) => !joined.has(c._id))
      .map((c) => ({ id: c._id, name: c.name, imageUrl: c.imageUrl }));
  },
});

export const get = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const community = await ctx.db.get(communityId);
    if (!community) return null;
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", me._id))
      .unique();
    if (!membership) return null;
    return {
      id: community._id,
      name: community.name,
      imageUrl: community.imageUrl,
      bannerUrl: community.bannerUrl,
      ownerId: community.ownerId,
      isOwner: community.ownerId === me._id,
      createdAt: community.createdAt,
    };
  },
});

export const join = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireCommunity(ctx, communityId);

    const ban = await ctx.db
      .query("communityBans")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", communityId).eq("userId", me._id)
      )
      .unique();
    if (ban) throw new Error("You're banned from this server.");

    const existing = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", me._id))
      .unique();
    if (existing) return;
    await ctx.db.insert("communityMembers", { communityId, userId: me._id, joinedAt: Date.now() });
  },
});

export const leave = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    if (community.ownerId === me._id) {
      throw new Error("The owner can't leave — delete the community instead.");
    }
    const membership = await requireMember(ctx, communityId, me._id);
    await ctx.db.delete(membership._id);

    const roles = await ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", me._id))
      .collect();
    for (const role of roles) await ctx.db.delete(role._id);
  },
});

export const updateSettings = mutation({
  args: { communityId: v.id("communities"), name: v.optional(v.string()) },
  handler: async (ctx, { communityId, name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);

    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Community name can't be empty.");
      await ctx.db.patch(communityId, { name: trimmed });
    }
  },
});

export const generateIconUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const setIcon = mutation({
  args: { communityId: v.id("communities"), storageId: v.id("_storage") },
  handler: async (ctx, { communityId, storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);

    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Icon upload failed.");
    const previous = community.iconStorageId;
    await ctx.db.patch(communityId, { imageUrl: url, iconStorageId: storageId });
    if (previous && previous !== storageId) await ctx.storage.delete(previous).catch(() => {});
  },
});

export const generateBannerUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const setBanner = mutation({
  args: { communityId: v.id("communities"), storageId: v.id("_storage") },
  handler: async (ctx, { communityId, storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Banner upload failed.");
    const previous = community.bannerStorageId;
    await ctx.db.patch(communityId, { bannerUrl: url, bannerStorageId: storageId });
    if (previous && previous !== storageId) await ctx.storage.delete(previous).catch(() => {});
    return url;
  },
});

export const removeBanner = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
    const previous = community.bannerStorageId;
    await ctx.db.patch(communityId, { bannerUrl: undefined, bannerStorageId: undefined });
    if (previous) await ctx.storage.delete(previous).catch(() => {});
  },
});

export const remove = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    if (community.ownerId !== me._id) throw new Error("Only the owner can delete a community.");

    const [members, roles, channels] = await Promise.all([
      ctx.db
        .query("communityMembers")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
      ctx.db
        .query("roles")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
      ctx.db
        .query("channels")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    ]);

    for (const channel of channels) {
      const [messages, overwrites, voiceParticipants] = await Promise.all([
        ctx.db
          .query("channelMessages")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .collect(),
        ctx.db
          .query("channelPermissionOverwrites")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .collect(),
        ctx.db
          .query("channelCallParticipants")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .collect(),
      ]);
      for (const message of messages) {
        const attachments = await ctx.db
          .query("channelMessageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect();
        for (const attachment of attachments) await ctx.db.delete(attachment._id);
        await ctx.db.delete(message._id);
      }
      for (const overwrite of overwrites) await ctx.db.delete(overwrite._id);
      for (const participant of voiceParticipants) await ctx.db.delete(participant._id);
      await ctx.db.delete(channel._id);
    }

    for (const role of roles) {
      const assignments = await ctx.db
        .query("memberRoles")
        .withIndex("by_role", (q) => q.eq("roleId", role._id))
        .collect();
      for (const assignment of assignments) await ctx.db.delete(assignment._id);
      await ctx.db.delete(role._id);
    }

    for (const member of members) await ctx.db.delete(member._id);

    if (community.iconStorageId) await ctx.storage.delete(community.iconStorageId).catch(() => {});
    await ctx.db.delete(communityId);
  },
});

export const listMembers = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const community = await ctx.db.get(communityId);
    if (!community) return [];
    await requireMember(ctx, communityId, me._id);

    const [members, memberRoles, roles] = await Promise.all([
      ctx.db
        .query("communityMembers")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
      ctx.db
        .query("memberRoles")
        .withIndex("by_member", (q) => q.eq("communityId", communityId))
        .collect(),
      ctx.db
        .query("roles")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    ]);
    const roleById = new Map(roles.map((r) => [r._id, r]));

    return Promise.all(
      members.map(async (member) => {
        const [user, serverProfile, presence] = await Promise.all([
          ctx.db.get(member.userId),
          ctx.db
            .query("serverProfiles")
            .withIndex("by_user_community", (q) =>
              q.eq("userId", member.userId).eq("communityId", communityId)
            )
            .unique(),
          ctx.db
            .query("presence")
            .withIndex("by_user", (q) => q.eq("userId", member.userId))
            .unique(),
        ]);
        const roleIds = memberRoles.filter((mr) => mr.userId === member.userId).map((mr) => mr.roleId);
        return {
          userId: member.userId,
          name: serverProfile?.displayName ?? user?.name ?? "Unknown",
          username: user?.username ?? "unknown",
          imageUrl: serverProfile?.imageUrl ?? user?.imageUrl,
          bio: serverProfile?.bio ?? user?.bio,
          customStatus: serverProfile?.customStatus ?? user?.customStatus,
          nameplateUrl: serverProfile?.nameplateUrl ?? user?.nameplateUrl,
          bannerUrl: serverProfile?.bannerUrl ?? user?.bannerUrl,
          borderGradientStart: serverProfile?.borderGradientStart ?? user?.borderGradientStart,
          borderGradientEnd: serverProfile?.borderGradientEnd ?? user?.borderGradientEnd,
          isOwner: community.ownerId === member.userId,
          timeoutUntil: member.timeoutUntil,
          status: presence?.effective ?? "offline",
          activities: activitiesOf(presence),
          roles: roleIds
            .map((id) => roleById.get(id))
            .filter((r): r is Doc<"roles"> => !!r)
            .map((r) => ({ id: r._id, name: r.name, color: r.color, position: r.position, hoist: r.hoist ?? false })),
        };
      })
    );
  },
});

/** Drop someone out of every voice channel in a community. Their client
 * watches its own participant row and leaves when it disappears. */
async function disconnectFromAllVoice(
  ctx: MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<void> {
  const channels = await ctx.db
    .query("channels")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  for (const channel of channels) {
    if (channel.type !== "voice") continue;
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channel._id).eq("userId", userId)
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  }
}

/** Remove a membership and everything hanging off it. Shared by kick and ban. */
async function removeMembership(
  ctx: MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<void> {
  const membership = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", userId))
    .unique();
  if (membership) await ctx.db.delete(membership._id);

  const roles = await ctx.db
    .query("memberRoles")
    .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
    .collect();
  for (const role of roles) await ctx.db.delete(role._id);

  await disconnectFromAllVoice(ctx, communityId, userId);
}

export const kickMember = mutation({
  args: { communityId: v.id("communities"), userId: v.id("users") },
  handler: async (ctx, { communityId, userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.KICK_MEMBERS);
    await requireAbove(ctx, community, me._id, userId);
    await removeMembership(ctx, communityId, userId);
  },
});

// --- Invites ---------------------------------------------------------------
// One active code per community (regenerating replaces it, invalidating
// anything posted/copied before) — simpler than Discord's many-invites-with-
// expiry model, matching what was actually asked for here.

const INVITE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generateInviteCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => INVITE_CHARS[b % INVITE_CHARS.length]).join("");
}

async function freshInviteCode(ctx: QueryCtx): Promise<string> {
  let code = generateInviteCode();
  while (
    await ctx.db
      .query("communities")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .unique()
  ) {
    code = generateInviteCode();
  }
  return code;
}

/**
 * Ban a member: record the ban, then remove them from the community. The ban
 * row outlives the membership so a fresh invite doesn't let them straight
 * back in (see `join`).
 */
export const listBans = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const community = await ctx.db.get(communityId);
    if (!community) return [];
    const perms = await getBasePermissions(ctx, community, me._id);
    if (!can(perms, PERMISSIONS.BAN_MEMBERS)) return [];

    const bans = await ctx.db
      .query("communityBans")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    return Promise.all(
      bans.map(async (ban) => {
        const user = await ctx.db.get(ban.userId);
        return {
          id: ban._id,
          userId: ban.userId,
          name: user?.name ?? "Unknown",
          username: user?.username ?? "unknown",
          imageUrl: user?.imageUrl,
          reason: ban.reason,
          createdAt: ban.createdAt,
        };
      })
    );
  },
});

export const banMember = mutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, userId, reason }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.BAN_MEMBERS);
    await requireAbove(ctx, community, me._id, userId);

    const existing = await ctx.db
      .query("communityBans")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", communityId).eq("userId", userId)
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("communityBans", {
        communityId,
        userId,
        bannedBy: me._id,
        reason: reason?.trim() || undefined,
        createdAt: Date.now(),
      });
    }

    await removeMembership(ctx, communityId, userId);
  },
});

export const unbanMember = mutation({
  args: { communityId: v.id("communities"), userId: v.id("users") },
  handler: async (ctx, { communityId, userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.BAN_MEMBERS);

    const ban = await ctx.db
      .query("communityBans")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", communityId).eq("userId", userId)
      )
      .unique();
    if (ban) await ctx.db.delete(ban._id);
  },
});

/**
 * Time a member out. They stay in the server, but `timeoutUntil` gates
 * sending messages and joining voice until it passes. A duration of 0 lifts
 * an active timeout.
 */
export const timeoutMember = mutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    durationMs: v.number(),
  },
  handler: async (ctx, { communityId, userId, durationMs }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MODERATE_MEMBERS);
    await requireAbove(ctx, community, me._id, userId);

    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", communityId).eq("userId", userId)
      )
      .unique();
    if (!membership) throw new Error("That user isn't a member.");

    await ctx.db.patch(membership._id, {
      timeoutUntil: durationMs > 0 ? Date.now() + durationMs : undefined,
    });

    // A timed-out member shouldn't stay sitting in voice.
    if (durationMs > 0) await disconnectFromAllVoice(ctx, communityId, userId);
  },
});

/** Set (or clear, with an empty string) another member's server nickname. */
export const setMemberNickname = mutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    nickname: v.string(),
  },
  handler: async (ctx, { communityId, userId, nickname }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    // Changing your own nickname only needs to be a member; changing someone
    // else's is a moderation action.
    if (me._id !== userId) {
      await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_NICKNAMES);
      await requireAbove(ctx, community, me._id, userId);
    } else {
      await requireMember(ctx, communityId, me._id);
    }

    const trimmed = nickname.trim();
    if (trimmed.length > 32) throw new Error("Nicknames are limited to 32 characters.");

    const profile = await ctx.db
      .query("serverProfiles")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", communityId)
      )
      .unique();

    if (profile) {
      await ctx.db.patch(profile._id, { displayName: trimmed || undefined });
    } else if (trimmed) {
      await ctx.db.insert("serverProfiles", {
        userId,
        communityId,
        displayName: trimmed,
      });
    }
  },
});

export const getOrCreateInviteCode = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.CREATE_INVITE);

    if (community.inviteCode) return community.inviteCode;
    const code = await freshInviteCode(ctx);
    await ctx.db.patch(communityId, { inviteCode: code });
    return code;
  },
});

export const regenerateInviteCode = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.CREATE_INVITE);

    const code = await freshInviteCode(ctx);
    await ctx.db.patch(communityId, { inviteCode: code });
    return code;
  },
});

/** Public preview of an invite — no membership required, so the join embed
 * can show the community's name/icon/member count before anyone clicks join. */
export const resolveInvite = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const community = await ctx.db
      .query("communities")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .unique();
    if (!community) return null;
    const [members, me] = await Promise.all([
      ctx.db
        .query("communityMembers")
        .withIndex("by_community", (q) => q.eq("communityId", community._id))
        .collect(),
      getCurrentUserOrNull(ctx),
    ]);
    let isMember = false;
    if (me) {
      const membership = await ctx.db
        .query("communityMembers")
        .withIndex("by_community_user", (q) =>
          q.eq("communityId", community._id).eq("userId", me._id)
        )
        .unique();
      isMember = !!membership;
    }
    return {
      id: community._id,
      name: community.name,
      imageUrl: community.imageUrl,
      bannerUrl: community.bannerUrl,
      memberCount: members.length,
      isMember,
    };
  },
});

export const joinByInviteCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await ctx.db
      .query("communities")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .unique();
    if (!community) throw new Error("Invalid or expired invite code.");

    const existing = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", community._id).eq("userId", me._id))
      .unique();
    if (!existing) {
      await ctx.db.insert("communityMembers", {
        communityId: community._id,
        userId: me._id,
        joinedAt: Date.now(),
      });
    }
    return community._id;
  },
});
