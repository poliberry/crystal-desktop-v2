import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { bitsHas, bitsOr, bitsWithout } from "./lib/permissionBits";
import { PERMISSIONS, type PermissionFlag } from "./lib/permissionFlags";
import { isMutationCtx, requireAdminAssurance } from "./lib/stepUp";

/**
 * Community permission bitfield. Mirrored (for rendering, not authority) on
 * the client at src/lib/permissions.ts — this file is the source of truth
 * enforced server-side.
 */
export { PERMISSIONS };

export type { PermissionFlag };

/**
 * The permissions that count as *administering* a server — the ones Discord also asks two-factor
 * for. Using one of these asks a member who has two-step verification for a code before a change
 * is made (see `enforceServerAssurance`).
 *
 * Everyday moderation (deleting a message, muting someone in a call) isn't here: it happens too
 * often for a code each time, and a server that requires two-step verification already covers it
 * through `SERVER_MODERATION_PERMISSIONS`.
 */
export const SERVER_ADMIN_PERMISSIONS: number =
  PERMISSIONS.ADMINISTRATOR |
  PERMISSIONS.MANAGE_COMMUNITY |
  PERMISSIONS.MANAGE_ROLES |
  PERMISSIONS.MANAGE_CHANNELS |
  PERMISSIONS.KICK_MEMBERS |
  PERMISSIONS.BAN_MEMBERS |
  PERMISSIONS.MANAGE_INTEGRATIONS |
  PERMISSIONS.MANAGE_GAME_SERVERS;

/** The server permissions that remove people, the only ones that ask for a code from a member who has two-step on. */
export const SERVER_DESTRUCTIVE_PERMISSIONS: number = PERMISSIONS.KICK_MEMBERS | PERMISSIONS.BAN_MEMBERS;

/** Every permission a server's "require two-step verification" setting covers: administering plus moderating. */
export const SERVER_MODERATION_PERMISSIONS: number =
  SERVER_ADMIN_PERMISSIONS |
  PERMISSIONS.MANAGE_MESSAGES |
  PERMISSIONS.MANAGE_EMOJIS |
  PERMISSIONS.MODERATE_MEMBERS |
  PERMISSIONS.MANAGE_EVENTS |
  PERMISSIONS.MANAGE_NICKNAMES |
  PERMISSIONS.MUTE_MEMBERS |
  PERMISSIONS.DEAFEN_MEMBERS |
  PERMISSIONS.MOVE_MEMBERS;

/**
 * The permissions that were always allowed before they had a flag of their own — attaching a
 * file, reacting, talking in voice. A community made before they existed has no bit for them on
 * @everyone, so an @everyone role that has never been saved since (`permsVersion` unset) is read
 * as holding these too — see `effectiveRolePermissions`. Nothing to migrate: the first save of
 * the role writes the whole set down and stamps it.
 * Not in here: anything that used to need a staff permission (pinning, creating events,
 * uploading emoji) — those stay with the staff roles until a community chooses to hand them out.
 */
export const NEW_DEFAULT_EVERYONE_FLAGS: number = [
  PERMISSIONS.CHANGE_NICKNAME,
  PERMISSIONS.EMBED_LINKS,
  PERMISSIONS.ATTACH_FILES,
  PERMISSIONS.ADD_REACTIONS,
  PERMISSIONS.USE_EXTERNAL_EMOJIS,
  PERMISSIONS.READ_MESSAGE_HISTORY,
  PERMISSIONS.USE_APPLICATION_COMMANDS,
  PERMISSIONS.SPEAK,
  PERMISSIONS.VIDEO,
  PERMISSIONS.USE_SOUNDBOARD,
  PERMISSIONS.USE_EXTERNAL_SOUNDS,
  PERMISSIONS.USE_VAD,
  PERMISSIONS.REQUEST_TO_SPEAK,
  PERMISSIONS.USE_EMBEDDED_ACTIVITIES,
  PERMISSIONS.CREATE_PUBLIC_THREADS,
  PERMISSIONS.SEND_MESSAGES_IN_THREADS,
  PERMISSIONS.USE_EXTERNAL_STICKERS,
  PERMISSIONS.SEND_VOICE_MESSAGES,
  PERMISSIONS.CREATE_POLLS,
].reduce(bitsOr, 0);

/** The current shape of a role's `permissions`. Roles saved before the wider set carry no version. */
export const ROLE_PERMS_VERSION = 1;

/** A role's permissions as they take effect: an old @everyone role also holds the new defaults. */
export function effectiveRolePermissions(
  role: Pick<Doc<"roles">, "permissions" | "isEveryone" | "permsVersion">,
): number {
  if (role.isEveryone && role.permsVersion === undefined) {
    return bitsOr(role.permissions, NEW_DEFAULT_EVERYONE_FLAGS);
  }
  return role.permissions;
}

/** Sensible defaults for a brand-new community's @everyone role. */
export const DEFAULT_EVERYONE_PERMISSIONS: number = bitsOr(
  PERMISSIONS.VIEW_CHANNELS |
    PERMISSIONS.SEND_MESSAGES |
    PERMISSIONS.CONNECT |
    PERMISSIONS.CREATE_INVITE,
  NEW_DEFAULT_EVERYONE_FLAGS,
);

function hasFlag(permissions: number, flag: number): boolean {
  return bitsHas(permissions, PERMISSIONS.ADMINISTRATOR) || bitsHas(permissions, flag);
}

/** A community's @everyone role (every community has exactly one), via `roles.by_community_everyone`. */
export async function getEveryoneRole(
  ctx: QueryCtx,
  communityId: Id<"communities">
): Promise<Doc<"roles"> | null> {
  return await ctx.db
    .query("roles")
    .withIndex("by_community_everyone", (q) => q.eq("communityId", communityId).eq("isEveryone", true))
    .unique();
}

/** What a member's permissions are built from, loaded once so any number of channels can be resolved from it. */
type MemberPermissionState = {
  everyoneRole: Doc<"roles"> | null;
  /** Ids of every role assigned to the member, whether or not the role still exists. */
  assignedRoleIds: Set<Id<"roles">>;
  /** The assigned roles that still exist. */
  roles: Doc<"roles">[];
};

async function loadMemberPermissionState(
  ctx: QueryCtx,
  community: Doc<"communities">,
  userId: Id<"users">
): Promise<MemberPermissionState> {
  const [everyoneRole, assigned] = await Promise.all([
    getEveryoneRole(ctx, community._id),
    ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", community._id).eq("userId", userId))
      .collect(),
  ]);
  const found = await Promise.all(assigned.map((m) => ctx.db.get(m.roleId)));
  return {
    everyoneRole,
    assignedRoleIds: new Set(assigned.map((m) => m.roleId)),
    roles: found.filter((r): r is Doc<"roles"> => r !== null),
  };
}

/** The base bitfield for a non-owner: @everyone OR'd with every assigned role. */
function baseFromState(state: MemberPermissionState): number {
  let perms = state.everyoneRole ? effectiveRolePermissions(state.everyoneRole) : 0;
  for (const role of state.roles) perms = bitsOr(perms, role.permissions);
  return perms;
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
  return baseFromState(await loadMemberPermissionState(ctx, community, userId));
}

/**
 * Applies one channel's permission overwrites on top of a member's base permissions, following
 * Discord's precedence: @everyone overwrite, then every applicable role overwrite (merged), then a
 * member-specific overwrite last (highest precedence). Pure: the single-channel and batch resolvers
 * both go through here, so they can't drift apart.
 */
export function applyChannelOverwrites(
  base: number,
  overwrites: ReadonlyArray<Pick<Doc<"channelPermissionOverwrites">, "roleId" | "userId" | "allow" | "deny">>,
  everyoneRoleId: Id<"roles"> | undefined,
  assignedRoleIds: ReadonlySet<Id<"roles">>,
  userId: Id<"users">
): number {
  if (overwrites.length === 0) return base;
  let perms = base;

  const everyoneOverwrite = everyoneRoleId
    ? overwrites.find((o) => o.roleId === everyoneRoleId)
    : undefined;
  if (everyoneOverwrite) {
    perms = bitsOr(bitsWithout(perms, everyoneOverwrite.deny), everyoneOverwrite.allow);
  }

  let roleAllow = 0;
  let roleDeny = 0;
  for (const o of overwrites) {
    if (o.roleId && assignedRoleIds.has(o.roleId) && o.roleId !== everyoneRoleId) {
      roleAllow = bitsOr(roleAllow, o.allow);
      roleDeny = bitsOr(roleDeny, o.deny);
    }
  }
  perms = bitsOr(bitsWithout(perms, roleDeny), roleAllow);

  const memberOverwrite = overwrites.find((o) => o.userId === userId);
  if (memberOverwrite) {
    perms = bitsOr(bitsWithout(perms, memberOverwrite.deny), memberOverwrite.allow);
  }

  return perms;
}

/**
 * A member's permissions in one channel: their base permissions with the channel's overwrites
 * applied (see `applyChannelOverwrites`). The owner has everything.
 */
export async function getChannelPermissions(
  ctx: QueryCtx,
  community: Doc<"communities">,
  channelId: Id<"channels">,
  userId: Id<"users">
): Promise<number> {
  if (community.ownerId === userId) return ~0;

  const [state, overwrites] = await Promise.all([
    loadMemberPermissionState(ctx, community, userId),
    ctx.db
      .query("channelPermissionOverwrites")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect(),
  ]);
  return applyChannelOverwrites(
    baseFromState(state),
    overwrites,
    state.everyoneRole?._id,
    state.assignedRoleIds,
    userId
  );
}

/**
 * `getChannelPermissions` for many channels of one community at once — what a channel list needs.
 * The @everyone role, the member's roles and their base permissions are read once instead of once
 * per channel; only each channel's overwrites are read per channel (overwrites carry no
 * communityId, so there's no single-index read for the whole community). Results are identical to
 * calling `getChannelPermissions` per channel.
 */
export async function getChannelPermissionsBatch(
  ctx: QueryCtx,
  community: Doc<"communities">,
  channelIds: ReadonlyArray<Id<"channels">>,
  userId: Id<"users">
): Promise<Map<Id<"channels">, number>> {
  const out = new Map<Id<"channels">, number>();
  if (channelIds.length === 0) return out;
  if (community.ownerId === userId) {
    for (const id of channelIds) out.set(id, ~0);
    return out;
  }

  const [state, overwritesByChannel] = await Promise.all([
    loadMemberPermissionState(ctx, community, userId),
    Promise.all(
      channelIds.map((channelId) =>
        ctx.db
          .query("channelPermissionOverwrites")
          .withIndex("by_channel", (q) => q.eq("channelId", channelId))
          .collect()
      )
    ),
  ]);
  const base = baseFromState(state);
  channelIds.forEach((channelId, i) => {
    out.set(
      channelId,
      applyChannelOverwrites(base, overwritesByChannel[i], state.everyoneRole?._id, state.assignedRoleIds, userId)
    );
  });
  return out;
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
  await enforceServerAssurance(ctx, community, userId, flag);
}

/**
 * Two-step verification for using a server's permissions, applied to everyone who passes
 * `requireCommunityPermission` — so no administrative function has to remember to ask.
 *
 *   - A server that requires two-step verification refuses any moderation permission to a member
 *     who hasn't turned it on. The owner included: the owner is who set the rule.
 *   - The administrative permissions ask a member who *has* it on for a code, on writes. (A query
 *     can't be paused for a code and retried, so reads are left alone: the data they show is
 *     what the member could already see.)
 */
export async function enforceServerAssurance(
  ctx: QueryCtx,
  community: Doc<"communities">,
  userId: Id<"users">,
  flag: number
): Promise<void> {
  const mustEnroll = community.requireTwoFactor === true && (flag & SERVER_MODERATION_PERMISSIONS) !== 0;
  // Only removing people is destructive enough to ask a code of someone who has two-step on.
  const asksForCode = isMutationCtx(ctx) && (flag & SERVER_DESTRUCTIVE_PERMISSIONS) !== 0;
  if (!mustEnroll && !asksForCode) return;
  await requireAdminAssurance(ctx, userId, { mustEnroll, why: "server", askForCode: asksForCode });
}

/**
 * Like `requireCommunityPermission`, for an action two permissions both cover — creating an event
 * takes Create Events *or* Manage Events — so a staff role that only ever had the old one keeps
 * working. Two-step verification is asked on account of whichever one the member actually used.
 */
export async function requireAnyCommunityPermission(
  ctx: QueryCtx,
  community: Doc<"communities">,
  userId: Id<"users">,
  flags: PermissionFlag[]
): Promise<void> {
  const perms = await getBasePermissions(ctx, community, userId);
  // The stricter of the two goes first, so a member who holds both is held to its rules.
  const used = flags.find((flag) => can(perms, flag));
  if (used === undefined) throw new Error("You don't have permission to do that.");
  await enforceServerAssurance(ctx, community, userId, used);
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
  await enforceServerAssurance(ctx, community, userId, flag);
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
