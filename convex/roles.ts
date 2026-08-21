import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import {
  PERMISSIONS,
  getBasePermissions,
  getHighestRolePosition,
  requireCommunityPermission,
} from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

export const list = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    await requireMember(ctx, communityId, me._id);
    const roles = await ctx.db
      .query("roles")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    return roles
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r._id,
        name: r.name,
        color: r.color,
        permissions: r.permissions,
        position: r.position,
        isEveryone: r.isEveryone,
        hoist: r.hoist ?? false,
      }));
  },
});

/** Enforces role hierarchy: you can only manage roles below your own highest
 * role, unless you own the community. */
async function assertCanManageRole(
  ctx: QueryCtx,
  community: Doc<"communities">,
  role: Doc<"roles">,
  userId: Doc<"users">["_id"]
) {
  if (community.ownerId === userId) return;
  const myPosition = await getHighestRolePosition(ctx, community._id, userId);
  if (role.position >= myPosition) {
    throw new Error("You can't manage a role at or above your own.");
  }
}

export const create = mutation({
  args: { communityId: v.id("communities"), name: v.string() },
  handler: async (ctx, { communityId, name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_ROLES);

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Role name can't be empty.");

    const existing = await ctx.db
      .query("roles")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const position = existing.reduce((max, r) => Math.max(max, r.position), 0) + 1;

    return ctx.db.insert("roles", {
      communityId,
      name: trimmed,
      permissions: 0,
      position,
      isEveryone: false,
    });
  },
});

export const update = mutation({
  args: {
    roleId: v.id("roles"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    permissions: v.optional(v.number()),
    hoist: v.optional(v.boolean()),
  },
  handler: async (ctx, { roleId, name, color, permissions, hoist }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const role = await ctx.db.get(roleId);
    if (!role) throw new Error("Role not found.");
    const community = await requireCommunity(ctx, role.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_ROLES);
    await assertCanManageRole(ctx, community, role, me._id);

    const patch: { name?: string; color?: string; permissions?: number; hoist?: boolean } = {};
    if (name !== undefined && !role.isEveryone) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Role name can't be empty.");
      patch.name = trimmed;
    }
    if (color !== undefined) patch.color = color;
    if (permissions !== undefined) patch.permissions = permissions;
    if (hoist !== undefined) patch.hoist = hoist;

    if (Object.keys(patch).length > 0) await ctx.db.patch(roleId, patch);
  },
});

export const remove = mutation({
  args: { roleId: v.id("roles") },
  handler: async (ctx, { roleId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const role = await ctx.db.get(roleId);
    if (!role) return;
    if (role.isEveryone) throw new Error("The @everyone role can't be deleted.");
    const community = await requireCommunity(ctx, role.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_ROLES);
    await assertCanManageRole(ctx, community, role, me._id);

    const assignments = await ctx.db
      .query("memberRoles")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();
    for (const assignment of assignments) await ctx.db.delete(assignment._id);

    const overwrites = await ctx.db.query("channelPermissionOverwrites").collect();
    for (const overwrite of overwrites) {
      if (overwrite.roleId === roleId) await ctx.db.delete(overwrite._id);
    }

    await ctx.db.delete(roleId);
  },
});

export const assign = mutation({
  args: { communityId: v.id("communities"), userId: v.id("users"), roleId: v.id("roles") },
  handler: async (ctx, { communityId, userId, roleId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    const role = await ctx.db.get(roleId);
    if (!role || role.communityId !== communityId) throw new Error("Role not found.");
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_ROLES);
    await assertCanManageRole(ctx, community, role, me._id);
    await requireMember(ctx, communityId, userId);

    const existing = await ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
      .collect();
    if (existing.some((m) => m.roleId === roleId)) return;

    await ctx.db.insert("memberRoles", { communityId, userId, roleId });
  },
});

export const unassign = mutation({
  args: { communityId: v.id("communities"), userId: v.id("users"), roleId: v.id("roles") },
  handler: async (ctx, { communityId, userId, roleId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    const role = await ctx.db.get(roleId);
    if (!role) return;
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_ROLES);
    await assertCanManageRole(ctx, community, role, me._id);

    const existing = await ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
      .collect();
    const match = existing.find((m) => m.roleId === roleId);
    if (match) await ctx.db.delete(match._id);
  },
});

/** My effective (channel-independent) permission bitfield in a community —
 * used by the client to decide which settings/management UI to show. */
export const myPermissions = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return 0;
    const community = await ctx.db.get(communityId);
    if (!community) return 0;
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", me._id))
      .unique();
    if (!membership) return 0;
    return getBasePermissions(ctx, community, me._id);
  },
});
