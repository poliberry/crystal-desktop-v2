import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Community permission bitfield. Mirrored (for rendering, not authority) on
 * the client at src/lib/permissions.ts — this file is the source of truth
 * enforced server-side.
 */
export const PERMISSIONS = {
  VIEW_CHANNELS: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  CONNECT: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_ROLES: 1 << 5,
  MANAGE_COMMUNITY: 1 << 6,
  KICK_MEMBERS: 1 << 7,
  ADMINISTRATOR: 1 << 8,
  CREATE_INVITE: 1 << 9,
  MANAGE_EMOJIS: 1 << 10,
  /** Server-mute a member in voice. */
  MUTE_MEMBERS: 1 << 11,
  /** Server-deafen a member in voice. */
  DEAFEN_MEMBERS: 1 << 12,
  /** Disconnect a member from voice. */
  MOVE_MEMBERS: 1 << 13,
  BAN_MEMBERS: 1 << 14,
  /** Time a member out — they stay in the server but can't talk. */
  MODERATE_MEMBERS: 1 << 15,
  MANAGE_NICKNAMES: 1 << 16,
} as const;

export type PermissionFlag = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Sensible defaults for a brand-new community's @everyone role. */
export const DEFAULT_EVERYONE_PERMISSIONS =
  PERMISSIONS.VIEW_CHANNELS |
  PERMISSIONS.SEND_MESSAGES |
  PERMISSIONS.CONNECT |
  PERMISSIONS.CREATE_INVITE;

function hasFlag(permissions: number, flag: number): boolean {
  return (permissions & PERMISSIONS.ADMINISTRATOR) !== 0 || (permissions & flag) !== 0;
}

/**
 * A member's base (channel-independent) permissions: the @everyone role's
 * permissions OR'd with every role explicitly assigned to them. The
 * community owner always has every permission, regardless of roles.
 */
export async function getBasePermissions(
  ctx: QueryCtx,
  community: Doc<"communities">,
  userId: Id<"users">
): Promise<number> {
  if (community.ownerId === userId) return ~0;

  const everyoneRole = await ctx.db
    .query("roles")
    .withIndex("by_community", (q) => q.eq("communityId", community._id))
    .filter((q) => q.eq(q.field("isEveryone"), true))
    .unique();

  const assigned = await ctx.db
    .query("memberRoles")
    .withIndex("by_member", (q) => q.eq("communityId", community._id).eq("userId", userId))
    .collect();
  const roles = await Promise.all(assigned.map((m) => ctx.db.get(m.roleId)));

  let perms = everyoneRole?.permissions ?? 0;
  for (const role of roles) {
    if (role) perms |= role.permissions;
  }
  return perms;
}

/**
 * Applies a channel's permission overwrites on top of a member's base
 * permissions, following Discord's precedence: @everyone overwrite, then
 * every applicable role overwrite (merged), then a member-specific
 * overwrite last (highest precedence).
 */
export async function getChannelPermissions(
  ctx: QueryCtx,
  community: Doc<"communities">,
  channelId: Id<"channels">,
  userId: Id<"users">
): Promise<number> {
  const base = await getBasePermissions(ctx, community, userId);
  if (community.ownerId === userId) return base;

  const overwrites = await ctx.db
    .query("channelPermissionOverwrites")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  if (overwrites.length === 0) return base;

  const everyoneRole = await ctx.db
    .query("roles")
    .withIndex("by_community", (q) => q.eq("communityId", community._id))
    .filter((q) => q.eq(q.field("isEveryone"), true))
    .unique();
  const assigned = await ctx.db
    .query("memberRoles")
    .withIndex("by_member", (q) => q.eq("communityId", community._id).eq("userId", userId))
    .collect();
  const roleIds = new Set(assigned.map((m) => m.roleId));

  let perms = base;

  const everyoneOverwrite = everyoneRole
    ? overwrites.find((o) => o.roleId === everyoneRole._id)
    : undefined;
  if (everyoneOverwrite) {
    perms = (perms & ~everyoneOverwrite.deny) | everyoneOverwrite.allow;
  }

  let roleAllow = 0;
  let roleDeny = 0;
  for (const o of overwrites) {
    if (o.roleId && roleIds.has(o.roleId) && o.roleId !== everyoneRole?._id) {
      roleAllow |= o.allow;
      roleDeny |= o.deny;
    }
  }
  perms = (perms & ~roleDeny) | roleAllow;

  const memberOverwrite = overwrites.find((o) => o.userId === userId);
  if (memberOverwrite) {
    perms = (perms & ~memberOverwrite.deny) | memberOverwrite.allow;
  }

  return perms;
}

export function can(permissions: number, flag: PermissionFlag): boolean {
  return hasFlag(permissions, flag);
}

export async function requireCommunityPermission(
  ctx: QueryCtx,
  community: Doc<"communities">,
  userId: Id<"users">,
  flag: PermissionFlag
): Promise<void> {
  const perms = await getBasePermissions(ctx, community, userId);
  if (!can(perms, flag)) throw new Error("You don't have permission to do that.");
}

export async function requireChannelPermission(
  ctx: QueryCtx,
  community: Doc<"communities">,
  channelId: Id<"channels">,
  userId: Id<"users">,
  flag: PermissionFlag
): Promise<void> {
  const perms = await getChannelPermissions(ctx, community, channelId, userId);
  if (!can(perms, flag)) throw new Error("You don't have permission to do that.");
}

/**
 * Refuse a moderation action against someone who outranks you.
 *
 * The owner is untouchable and can act on anyone; otherwise the actor's
 * highest role must sit strictly above the target's. Without this, two
 * moderators holding the same role could mute or ban each other, and anyone
 * with a permission could use it on the owner.
 */
export async function requireAbove(
  ctx: QueryCtx,
  community: Doc<"communities">,
  actorId: Id<"users">,
  targetId: Id<"users">
): Promise<void> {
  if (actorId === targetId) throw new Error("You can't do that to yourself.");
  if (community.ownerId === actorId) return;
  if (community.ownerId === targetId) {
    throw new Error("You can't do that to the server owner.");
  }
  const [actorRank, targetRank] = await Promise.all([
    getHighestRolePosition(ctx, community._id, actorId),
    getHighestRolePosition(ctx, community._id, targetId),
  ]);
  if (actorRank <= targetRank) {
    throw new Error("You can't do that to someone with an equal or higher role.");
  }
}

/** The highest `position` among a member's assigned roles — used to enforce
 * role hierarchy (you can't edit/assign/delete a role at or above your own
 * highest role, unless you own the community). */
export async function getHighestRolePosition(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<number> {
  const assigned = await ctx.db
    .query("memberRoles")
    .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
    .collect();
  const roles = await Promise.all(assigned.map((m) => ctx.db.get(m.roleId)));
  return roles.reduce((max, role) => (role ? Math.max(max, role.position) : max), -1);
}
