import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { DEFAULT_EVERYONE_PERMISSIONS, requireCommunityPermission } from "./permissions";
import { PERMISSIONS } from "./permissions";
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
          status: presence?.effective ?? "offline",
          roles: roleIds
            .map((id) => roleById.get(id))
            .filter((r): r is Doc<"roles"> => !!r)
            .map((r) => ({ id: r._id, name: r.name, color: r.color, position: r.position, hoist: r.hoist ?? false })),
        };
      })
    );
  },
});

export const kickMember = mutation({
  args: { communityId: v.id("communities"), userId: v.id("users") },
  handler: async (ctx, { communityId, userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    if (userId === community.ownerId) throw new Error("Can't kick the owner.");
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.KICK_MEMBERS);

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
