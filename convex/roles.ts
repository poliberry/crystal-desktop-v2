import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import { auditUserTarget, logCommunityAudit } from "./lib/communityAudit";
import { describePermissionChange, joinDetails } from "./lib/communityAuditActions";
import { isValidBits } from "./lib/permissionBits";
import { scheduleVoiceSync } from "./lib/voiceAccess";
import {
  PERMISSIONS,
  ROLE_PERMS_VERSION,
  can,
  effectiveRolePermissions,
  getBasePermissions,
  getHighestRolePosition,
  requireCommunityPermission,
} from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/** The caller's membership check and the community's roles, best first — shared by `list` and `listWithCounts`. */
async function loadRolesForMember(ctx: QueryCtx, communityId: Id<"communities">) {
  const me = await getCurrentUserOrNull(ctx);
  if (!me) return null;
  // Empty rather than thrown for someone who isn't (or is no longer) in it,
  // like `channels.list` beside it: the data preloader subscribes to this for
  // every community in the rail, and the moment one is deleted or left is a
  // moment that query re-runs against a membership that is already gone — a
  // throw there is an uncaught render error for the whole app.
  const membership = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", me._id))
    .unique();
  if (!membership) return null;
  const roles = await ctx.db
    .query("roles")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  return roles.sort((a, b) => b.position - a.position);
}

function roleView(r: Doc<"roles">) {
  return {
    id: r._id,
    name: r.name,
    color: r.color,
    // As it takes effect, so the editor shows an old @everyone with the defaults it holds.
    permissions: effectiveRolePermissions(r),
    position: r.position,
    isEveryone: r.isEveryone,
    hoist: r.hoist ?? false,
  };
}

/**
 * The roles, without how many members hold each. Preloaded for every community in the rail, so it
 * reads nothing but the roles themselves; the counts are `listWithCounts`, for the roles settings.
 */
export const list = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const roles = await loadRolesForMember(ctx, communityId);
    return (roles ?? []).map(roleView);
  },
});

/** `list` plus a member count on every role — what the roles settings page shows. */
export const listWithCounts = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const roles = await loadRolesForMember(ctx, communityId);
    if (!roles) return [];

    // One pass over the assignments rather than a count query per role: the
    // list shows a member count on every row, and a server with thirty roles
    // would otherwise be thirty reads to render one screen.
    const assignments = await ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId))
      .collect();
    const countByRole = new Map<string, number>();
    for (const assignment of assignments) {
      const key = assignment.roleId as string;
      countByRole.set(key, (countByRole.get(key) ?? 0) + 1);
    }
    // The denormalised count where there is one (see `communities.memberCount`).
    const community = await ctx.db.get(communityId);
    const memberCount =
      community?.memberCount ??
      (
        await ctx.db
          .query("communityMembers")
          .withIndex("by_community", (q) => q.eq("communityId", communityId))
          .collect()
      ).length;

    return roles.map((r) => ({
      ...roleView(r),
      /** @everyone is held by definition, so it counts the whole server
       * rather than the assignment rows it doesn't have. */
      memberCount: r.isEveryone ? memberCount : (countByRole.get(r._id as string) ?? 0),
    }));
  },
});

/** Everyone holding a role, for the editor's "Manage Members" tab. */
export const listMembers = query({
  args: { roleId: v.id("roles") },
  handler: async (ctx, { roleId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const role = await ctx.db.get(roleId);
    if (!role) return [];
    await requireMember(ctx, role.communityId, me._id);

    const assignments = await ctx.db
      .query("memberRoles")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();

    const members = await Promise.all(
      assignments.map(async (assignment) => {
        const [user, serverProfile] = await Promise.all([
          ctx.db.get(assignment.userId),
          ctx.db
            .query("serverProfiles")
            .withIndex("by_user_community", (q) =>
              q.eq("userId", assignment.userId).eq("communityId", role.communityId)
            )
            .unique(),
        ]);
        if (!user) return null;
        return {
          userId: user._id,
          name: serverProfile?.displayName ?? user.name,
          username: user.username,
          imageUrl: serverProfile?.imageUrl ?? user.imageUrl,
        };
      })
    );
    return members
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** A bot's role is its grant. It is changed from the community's Bots settings, by someone who
 * holds what they give — not here, where a role editor could hand a bot more than that. */
function assertNotBotRole(role: Doc<"roles">) {
  if (role.managedBotId) throw new Error("This role belongs to a bot. Change what it can do in the community's Bots settings.");
}

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

    const roleId = await ctx.db.insert("roles", {
      communityId,
      name: trimmed,
      permissions: 0,
      permsVersion: ROLE_PERMS_VERSION,
      position,
      isEveryone: false,
    });
    await logCommunityAudit(ctx, { communityId, actorId: me._id, action: "role.create", target: { type: "role", id: roleId, name: trimmed } });
    return roleId;
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
    assertNotBotRole(role);

    const patch: { name?: string; color?: string; permissions?: number; permsVersion?: number; hoist?: boolean } = {};
    if (name !== undefined && !role.isEveryone) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Role name can't be empty.");
      patch.name = trimmed;
    }
    if (color !== undefined) patch.color = color;
    if (permissions !== undefined) {
      if (!isValidBits(permissions)) throw new Error("Those permissions aren't valid.");
      patch.permissions = permissions;
      // Written whole from now on: whatever the editor showed (an old @everyone included, with
      // the defaults it already held) is what is stored.
      patch.permsVersion = ROLE_PERMS_VERSION;
    }
    if (hoist !== undefined) patch.hoist = hoist;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(roleId, patch);
      // Anyone already in a voice channel holds the rights their token was minted with until told otherwise.
      if (patch.permissions !== undefined) await scheduleVoiceSync(ctx, { communityId: role.communityId });
      await logCommunityAudit(ctx, {
        communityId: role.communityId,
        actorId: me._id,
        action: "role.update",
        target: { type: "role", id: roleId, name: patch.name ?? role.name },
        details: joinDetails(
          patch.name !== undefined && patch.name !== role.name && `Renamed from "${role.name}"`,
          patch.color !== undefined && patch.color !== role.color && "Changed the colour",
          patch.hoist !== undefined && patch.hoist !== (role.hoist ?? false) && `Shown separately: ${patch.hoist ? "on" : "off"}`,
          patch.permissions !== undefined && describePermissionChange(effectiveRolePermissions(role), patch.permissions),
        ),
      });
    }
  },
});

/**
 * Rewrite the whole ladder from a highest-first list of role ids.
 *
 * Positions are recomputed from the order rather than swapped pairwise, so a
 * drag that moves a role past several others is one write per role and can't
 * leave two roles sharing a position. `@everyone` is pinned at the bottom
 * whatever the client sends — everything else is defined relative to it.
 *
 * Every role that actually moves is checked against the caller's own rank, so
 * this can't be used to lift a role above the person doing the dragging.
 */
export const reorder = mutation({
  args: { communityId: v.id("communities"), orderedIds: v.array(v.id("roles")) },
  handler: async (ctx, { communityId, orderedIds }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_ROLES);

    const roles = await ctx.db
      .query("roles")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const byId = new Map(roles.map((r) => [r._id as string, r]));

    const ordered = orderedIds
      .map((id) => byId.get(id as string))
      .filter((r): r is Doc<"roles"> => !!r && !r.isEveryone);
    if (ordered.length !== roles.filter((r) => !r.isEveryone).length) {
      throw new Error("The role order has changed since this list was read.");
    }

    // Highest-first in, descending positions out, leaving 0 for @everyone.
    const top = ordered.length;
    for (const [index, role] of ordered.entries()) {
      const position = top - index;
      if (position === role.position) continue;
      await assertCanManageRole(ctx, community, role, me._id);
      await ctx.db.patch(role._id, { position });
    }

    const everyone = roles.find((r) => r.isEveryone);
    if (everyone && everyone.position !== 0) await ctx.db.patch(everyone._id, { position: 0 });
    await logCommunityAudit(ctx, { communityId, actorId: me._id, action: "role.reorder" });
  },
});

/**
 * Copy a role's colour, permissions and hoist setting into a new one directly
 * below it. Members are deliberately not copied: duplicating is for building a
 * variant of a role's *permissions*, and inheriting its holders is rarely what
 * anyone means by it.
 */
export const duplicate = mutation({
  args: { roleId: v.id("roles") },
  handler: async (ctx, { roleId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const role = await ctx.db.get(roleId);
    if (!role) throw new Error("Role not found.");
    if (role.isEveryone) throw new Error("The @everyone role can't be duplicated.");
    const community = await requireCommunity(ctx, role.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_ROLES);
    await assertCanManageRole(ctx, community, role, me._id);
    assertNotBotRole(role);

    const existing = await ctx.db
      .query("roles")
      .withIndex("by_community", (q) => q.eq("communityId", role.communityId))
      .collect();
    const position = existing.reduce((max, r) => Math.max(max, r.position), 0) + 1;

    const copyName = `${role.name} copy`.slice(0, 32);
    const copyId = await ctx.db.insert("roles", {
      communityId: role.communityId,
      name: copyName,
      color: role.color,
      permissions: effectiveRolePermissions(role),
      permsVersion: ROLE_PERMS_VERSION,
      position,
      isEveryone: false,
      hoist: role.hoist,
    });
    await logCommunityAudit(ctx, { communityId: role.communityId, actorId: me._id, action: "role.create", target: { type: "role", id: copyId, name: copyName }, details: `Copied from "${role.name}"` });
    return copyId;
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
    assertNotBotRole(role);

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
    await scheduleVoiceSync(ctx, { communityId: role.communityId });
    await logCommunityAudit(ctx, { communityId: role.communityId, actorId: me._id, action: "role.delete", target: { type: "role", id: roleId, name: role.name }, details: assignments.length > 0 ? `Held by ${assignments.length} member${assignments.length === 1 ? "" : "s"}` : undefined });
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
    assertNotBotRole(role);
    await requireMember(ctx, communityId, userId);

    const existing = await ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
      .collect();
    if (existing.some((m) => m.roleId === roleId)) return;

    await ctx.db.insert("memberRoles", { communityId, userId, roleId });
    await scheduleVoiceSync(ctx, { communityId, userId });
    await logCommunityAudit(ctx, { communityId, actorId: me._id, action: "role.assign", target: await auditUserTarget(ctx, userId), details: `Role: ${role.name}` });
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
    assertNotBotRole(role);

    const existing = await ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
      .collect();
    const match = existing.find((m) => m.roleId === roleId);
    if (match) {
      await ctx.db.delete(match._id);
      await scheduleVoiceSync(ctx, { communityId, userId });
      await logCommunityAudit(ctx, { communityId, actorId: me._id, action: "role.unassign", target: await auditUserTarget(ctx, userId), details: `Role: ${role.name}` });
    }
  },
});

/**
 * What a member can do community-wide, and which roles it comes from — for the Members tab's
 * read-only "View permissions". Whoever manages roles can look at anyone; anyone can look at
 * themselves. Channel overwrites are not folded in: they differ per channel, and are read where
 * they are set (Channels → Permissions).
 */
export const memberPermissions = query({
  args: { communityId: v.id("communities"), userId: v.id("users") },
  handler: async (ctx, { communityId, userId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const community = await ctx.db.get(communityId);
    if (!community) return null;
    const mine = await getBasePermissions(ctx, community, me._id);
    if (me._id !== userId && !can(mine, PERMISSIONS.MANAGE_ROLES)) return null;
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", userId))
      .unique();
    if (!membership) return null;

    const assigned = await ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
      .collect();
    const everyone = await ctx.db
      .query("roles")
      .withIndex("by_community_everyone", (q) => q.eq("communityId", communityId).eq("isEveryone", true))
      .unique();
    const held = (await Promise.all(assigned.map((m) => ctx.db.get(m.roleId)))).filter(
      (r): r is Doc<"roles"> => !!r,
    );
    const roles = [...(everyone ? [everyone] : []), ...held.sort((a, b) => b.position - a.position)];
    return {
      isOwner: community.ownerId === userId,
      roles: roles.map((r) => ({
        id: r._id,
        name: r.name,
        color: r.color,
        isEveryone: r.isEveryone,
        permissions: effectiveRolePermissions(r),
      })),
    };
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
