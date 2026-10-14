import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { grantEntitlements, isActive, ownsSku } from "./lib/entitlements";
import { abilityValidator, normalizeAbilities } from "./lib/abilities";
import { banAddressesOf, countAddressBansOf, liftAddressBansOf } from "./lib/ipBans";
import { ipProtectionConfigured } from "./lib/ip";
import { activeBan, activeLimits, activeSuspension, effectiveCommunityStatus, INDEFINITE } from "./lib/moderation";
import { revokeSessions } from "./lib/sessions";
import { assertStaffAssurance, audit, getStaff, requireStaff } from "./lib/staff";
import { can } from "./lib/staffPermissions";
import { badgeByIdMap, badgeView } from "./badges";
import { ensureBadgeDefinition } from "./badges";
import { grantBadge, revokeBadge } from "./users";

/**
 * Platform operations for the staff console: finding and acting on accounts and
 * communities.
 *
 * Every function starts with `requireStaff`, naming what it needs. What an
 * account's *orders* look like is finance's to see, not a moderator's, so
 * `userDetail` returns purchase amounts only to someone with `finance.read`.
 */

const MAX_RESULTS = 50;

/** Counts for the console's home page, limited to what the caller may see. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const staff = await getStaff(ctx);
    if (!staff) return null;
    await assertStaffAssurance(ctx, staff);
    const has = (permission: Parameters<typeof can>[1]) => can(staff.roles, permission);
    const count = async <T,>(rows: Promise<T[]>) => (await rows).length;

    const [openReports, reviewingReports, pendingSubmissions, openTickets, unpaidPayouts] = await Promise.all([
      has("reports.read")
        ? count(ctx.db.query("reports").withIndex("by_status", (q) => q.eq("status", "open")).take(500))
        : null,
      has("reports.read")
        ? count(ctx.db.query("reports").withIndex("by_status", (q) => q.eq("status", "reviewing")).take(500))
        : null,
      has("catalog.read")
        ? count(ctx.db.query("marketplaceSubmissions").withIndex("by_status", (q) => q.eq("status", "pending")).take(500))
        : null,
      has("support.read")
        ? count(ctx.db.query("supportTickets").withIndex("by_status", (q) => q.eq("status", "open")).take(500))
        : null,
      has("finance.read")
        ? count(ctx.db.query("creatorEarnings").withIndex("by_status", (q) => q.eq("status", "pending")).take(500))
        : null,
    ]);
    const inProgressTickets = has("support.read")
      ? await count(ctx.db.query("supportTickets").withIndex("by_status", (q) => q.eq("status", "in_progress")).take(500))
      : null;

    return { openReports, reviewingReports, pendingSubmissions, openTickets, inProgressTickets, unpaidPayouts };
  },
});

/** One line per account. */
function userRow(user: Doc<"users">) {
  const suspension = activeSuspension(user);
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    imageUrl: user.imageUrl,
    joinedAt: user._creationTime,
    suspended: suspension
      ? { until: suspension.indefinite ? null : suspension.until, reason: suspension.reason ?? null }
      : null,
    banned: activeBan(user) !== null,
    limited: activeLimits(user) !== null,
  };
}

/** Search accounts by username (prefix) or display name; with no search, the
 * newest ones. */
export const users = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    await requireStaff(ctx, "users.read");
    const needle = search?.trim().toLowerCase().replace(/^@/, "") ?? "";
    if (!needle) {
      const rows = await ctx.db.query("users").order("desc").take(MAX_RESULTS);
      return rows.map(userRow);
    }
    const byUsername = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.gte("username", needle).lt("username", `${needle}￿`))
      .take(MAX_RESULTS);
    const byName = await ctx.db
      .query("users")
      .withSearchIndex("search_name", (q) => q.search("name", needle))
      .take(MAX_RESULTS);
    const seen = new Set<Id<"users">>();
    const merged: Doc<"users">[] = [];
    for (const user of [...byUsername, ...byName]) {
      if (seen.has(user._id)) continue;
      seen.add(user._id);
      merged.push(user);
    }
    return merged.slice(0, MAX_RESULTS).map(userRow);
  },
});

/** Everything staff need to know about one account, in one place. */
export const userDetail = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const staff = await requireStaff(ctx, "users.read");
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const seesFinance = can(staff.roles, "finance.read");

    const [log, reportsAbout, reportsBy, entitlements, memberships, owned, staffRow, orders, creator] =
      await Promise.all([
        ctx.db.query("platformModerationLog").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(30),
        ctx.db.query("reports").withIndex("by_target_user", (q) => q.eq("targetUserId", userId)).order("desc").take(30),
        ctx.db.query("reports").withIndex("by_reporter", (q) => q.eq("reporterId", userId)).order("desc").take(30),
        ctx.db.query("entitlements").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(100),
        ctx.db.query("communityMembers").withIndex("by_user", (q) => q.eq("userId", userId)).take(200),
        ctx.db.query("communities").filter((q) => q.eq(q.field("ownerId"), userId)).take(50),
        ctx.db.query("staffMembers").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
        ctx.db.query("orders").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(30),
        ctx.db.query("creatorAccounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
      ]);

    const actors = new Map<Id<"users">, string>();
    // No actor means the platform acted by itself (a signup from a banned network).
    const nameOf = async (id: Id<"users"> | undefined) => {
      if (!id) return "Crystal";
      if (!actors.has(id)) actors.set(id, (await ctx.db.get(id))?.username ?? "unknown");
      return actors.get(id)!;
    };

    const suspension = activeSuspension(user);
    const ban = activeBan(user);
    const limits = activeLimits(user);
    const [badgeRows, badgeDefinitions] = await Promise.all([
      ctx.db.query("userBadges").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      badgeByIdMap(ctx),
    ]);
    return {
      user: { ...userRow(user), bio: user.bio, customStatus: user.customStatus },
      suspension: suspension
        ? { until: suspension.indefinite ? null : suspension.until, reason: suspension.reason ?? null }
        : null,
      ban: ban ? { at: ban.at, reason: ban.reason ?? null } : null,
      limits: limits ? { abilities: limits.abilities, until: limits.until, reason: limits.reason ?? null } : null,
      // Only ever a yes/no and a count: the addresses themselves are never shown.
      network: {
        protectionOn: ipProtectionConfigured(),
        bannedNetworks: await countAddressBansOf(ctx, userId),
      },
      isStaff: !!staffRow && staffRow.revokedAt === undefined,
      badges: badgeRows
        .map((row) => {
          const badge = badgeDefinitions.get(row.badgeId);
          return badge ? { ...badgeView(badge), grantedAt: row.grantedAt } : null;
        })
        .filter((badge): badge is NonNullable<typeof badge> => badge !== null),
      moderationLog: await Promise.all(
        log.map(async (entry) => ({
          id: entry._id,
          action: entry.action,
          reason: entry.reason,
          until: entry.until ?? null,
          abilities: entry.abilities ?? null,
          createdAt: entry.createdAt,
          actor: await nameOf(entry.actorId),
        })),
      ),
      reportsAbout: reportsAbout.map((r) => ({ id: r._id, category: r.category, status: r.status, createdAt: r.createdAt })),
      reportsFiled: reportsBy.length,
      communities: { member: memberships.length, owned: owned.map((c) => ({ id: c._id, name: c.name })) },
      entitlements: await Promise.all(
        entitlements.map(async (e) => ({
          id: e._id,
          skuName: (await ctx.db.get(e.skuId))?.name ?? "Removed item",
          kind: e.kind,
          source: e.source,
          active: isActive(e),
          revokedAt: e.revokedAt ?? null,
          expiresAt: e.expiresAt ?? null,
          createdAt: e.createdAt,
          communityName: e.communityId ? (await ctx.db.get(e.communityId))?.name ?? null : null,
        })),
      ),
      // Purchases carry money, which only finance sees; everyone else learns only
      // how many there are.
      orderCount: orders.length,
      orders: seesFinance
        ? orders.map((o) => ({
            id: o._id,
            skuName: o.skuName,
            status: o.status,
            amountCents: o.amountCents,
            currency: o.currency,
            createdAt: o.createdAt,
          }))
        : null,
      creator: seesFinance && creator ? { payoutsEnabled: creator.payoutsEnabled } : null,
    };
  },
});

/** Give or remove a catalogue badge from an account through the staff console. */
export const setUserBadge = mutation({
  args: { userId: v.id("users"), badgeId: v.string(), granted: v.boolean(), reason: v.string() },
  handler: async (ctx, { userId, badgeId, granted, reason }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const user = await ctx.db.get(userId);
    // A built-in badge whose definition was never seeded is created here, so it can be given.
    const badge = await ensureBadgeDefinition(ctx, badgeId);
    if (!user || !badge) throw new Error("User or badge not found.");
    const why = reason.trim().slice(0, 300);
    if (why.length < 3) throw new Error("Say why this badge is being changed.");
    if (granted) await grantBadge(ctx, userId, badgeId);
    else await revokeBadge(ctx, userId, badgeId);
    await audit(ctx, staff.user._id, granted ? "users.badge.grant" : "users.badge.revoke", { type: "user", id: userId }, `${badge.label} for @${user.username} — ${why}`);
  },
});

const MAX_SUSPENSION_DAYS = 365;

export const suspendUser = mutation({
  args: {
    userId: v.id("users"),
    /** Days; omit for indefinite. */
    days: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, { userId, days, reason }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found.");
    if (userId === staff.user._id) throw new Error("You can't suspend yourself.");
    // Staff accounts are changed through Staff & roles, on the record.
    const target = await ctx.db.query("staffMembers").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (target && target.revokedAt === undefined) throw new Error("Remove their staff access first.");

    const why = reason.trim().slice(0, 500);
    if (why.length < 3) throw new Error("A reason is required.");
    if (days !== undefined && (!Number.isFinite(days) || days <= 0 || days > MAX_SUSPENSION_DAYS)) {
      throw new Error(`A suspension is between 1 and ${MAX_SUSPENSION_DAYS} days, or indefinite.`);
    }
    const until = days === undefined ? INDEFINITE : Date.now() + Math.round(days * 24 * 60 * 60 * 1000);

    await ctx.db.patch(userId, { platformSuspendedUntil: until, platformSuspensionReason: why });
    // Signed out now, everywhere, rather than whenever their token happens to run out. They can't
    // sign back in until it ends: the sign-in screen tells them why instead.
    await revokeSessions(ctx, userId);
    await ctx.db.insert("platformModerationLog", {
      userId,
      actorId: staff.user._id,
      action: "suspend",
      until: days === undefined ? undefined : until,
      reason: why,
      createdAt: Date.now(),
    });
    await audit(
      ctx,
      staff.user._id,
      "users.suspend",
      { type: "user", id: userId },
      `${user.username}: ${days === undefined ? "indefinitely" : `${days} days`} — ${why}`,
    );
  },
});

export const unsuspendUser = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, { userId, reason }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found.");
    await ctx.db.patch(userId, { platformSuspendedUntil: undefined, platformSuspensionReason: undefined });
    await ctx.db.insert("platformModerationLog", {
      userId,
      actorId: staff.user._id,
      action: "unsuspend",
      reason: reason?.trim().slice(0, 500) || undefined,
      createdAt: Date.now(),
    });
    await audit(ctx, staff.user._id, "users.unsuspend", { type: "user", id: userId }, user.username);
  },
});

/** The account staff are about to act on, refusing the cases that are never
 * right: acting on yourself, or on another member of staff (whose access is
 * changed through Staff & roles, on the record). */
async function moderationTarget(ctx: QueryCtx, staffUserId: Id<"users">, userId: Id<"users">, verb: string) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found.");
  if (userId === staffUserId) throw new Error(`You can't ${verb} yourself.`);
  const target = await ctx.db.query("staffMembers").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (target && target.revokedAt === undefined) throw new Error("Remove their staff access first.");
  return user;
}

function cleanReason(reason: string | undefined, required: boolean): string | undefined {
  const why = reason?.trim().slice(0, 500);
  if (required && (!why || why.length < 3)) throw new Error("A reason is required.");
  return why || undefined;
}

/** Take some abilities away from an account for a while (or until lifted). It
 * keeps signing in and reading; the server refuses just these. */
export const limitUser = mutation({
  args: {
    userId: v.id("users"),
    abilities: v.array(abilityValidator),
    /** Days; omit for until lifted. */
    days: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, { userId, abilities, days, reason }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const user = await moderationTarget(ctx, staff.user._id, userId, "limit");
    const why = cleanReason(reason, true)!;
    const chosen = normalizeAbilities(abilities);
    if (chosen.length === 0) throw new Error("Pick at least one thing to limit, or lift the limits instead.");
    if (days !== undefined && (!Number.isFinite(days) || days <= 0 || days > MAX_SUSPENSION_DAYS)) {
      throw new Error(`A limit is between 1 and ${MAX_SUSPENSION_DAYS} days, or until lifted.`);
    }
    const until = days === undefined ? undefined : Date.now() + Math.round(days * 24 * 60 * 60 * 1000);

    await ctx.db.patch(userId, { platformLimits: chosen, platformLimitedUntil: until, platformLimitReason: why });
    await ctx.db.insert("platformModerationLog", {
      userId,
      actorId: staff.user._id,
      action: "limit",
      abilities: chosen,
      until,
      reason: why,
      createdAt: Date.now(),
    });
    await audit(
      ctx,
      staff.user._id,
      "users.limit",
      { type: "user", id: userId },
      `${user.username}: ${chosen.join(", ")} ${days === undefined ? "until lifted" : `for ${days} days`} — ${why}`,
    );
  },
});

export const unlimitUser = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, { userId, reason }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found.");
    await ctx.db.patch(userId, { platformLimits: undefined, platformLimitedUntil: undefined, platformLimitReason: undefined });
    await ctx.db.insert("platformModerationLog", {
      userId,
      actorId: staff.user._id,
      action: "unlimit",
      reason: cleanReason(reason, false),
      createdAt: Date.now(),
    });
    await audit(ctx, staff.user._id, "users.unlimit", { type: "user", id: userId }, user.username);
  },
});

/**
 * Ban an account: it can no longer do or read anything, and — unless
 * `includeNetwork` is switched off — new accounts can't be opened from the
 * addresses it has used. Lasts until lifted.
 *
 * Only the *count* of networks covered is reported or logged. The addresses are
 * never returned, shown, or written to the audit log.
 */
export const banUser = mutation({
  args: { userId: v.id("users"), reason: v.string(), includeNetwork: v.optional(v.boolean()) },
  handler: async (ctx, { userId, reason, includeNetwork }) => {
    const staff = await requireStaff(ctx, "users.ban");
    const user = await moderationTarget(ctx, staff.user._id, userId, "ban");
    if (activeBan(user)) throw new Error("They're already banned.");
    const why = cleanReason(reason, true)!;
    const now = Date.now();

    await ctx.db.patch(userId, { platformBannedAt: now, platformBanReason: why });
    await revokeSessions(ctx, userId);
    const networks = includeNetwork === false ? 0 : await banAddressesOf(ctx, userId, staff.user._id, why);
    await ctx.db.insert("platformModerationLog", {
      userId,
      actorId: staff.user._id,
      action: "ban",
      reason: why,
      createdAt: now,
    });
    await audit(
      ctx,
      staff.user._id,
      "users.ban",
      { type: "user", id: userId },
      `${user.username}: ${includeNetwork === false ? "account only" : `account and ${networks} network${networks === 1 ? "" : "s"}`} — ${why}`,
    );
    return { networks };
  },
});

/** Lift a ban, and the network bans that came with it. */
export const unbanUser = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, { userId, reason }) => {
    const staff = await requireStaff(ctx, "users.ban");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found.");
    if (!activeBan(user)) throw new Error("They aren't banned.");
    await ctx.db.patch(userId, { platformBannedAt: undefined, platformBanReason: undefined });
    const networks = await liftAddressBansOf(ctx, userId);
    await ctx.db.insert("platformModerationLog", {
      userId,
      actorId: staff.user._id,
      action: "unban",
      reason: cleanReason(reason, false),
      createdAt: Date.now(),
    });
    await audit(ctx, staff.user._id, "users.unban", { type: "user", id: userId }, `${user.username}: ${networks} network${networks === 1 ? "" : "s"} lifted`);
  },
});

/** Give someone an item without a purchase: a gift, or making good on a problem. */
export const grantSku = mutation({
  args: {
    userId: v.id("users"),
    skuId: v.id("skus"),
    communityId: v.optional(v.id("communities")),
    reason: v.string(),
  },
  handler: async (ctx, { userId, skuId, communityId, reason }) => {
    const staff = await requireStaff(ctx, "users.entitle");
    const [user, sku] = await Promise.all([ctx.db.get(userId), ctx.db.get(skuId)]);
    if (!user || !sku) throw new Error("User or item not found.");
    const why = reason.trim().slice(0, 300);
    if (why.length < 3) throw new Error("Say why this is being given.");
    if (sku.type === "community") {
      if (!communityId || !(await ctx.db.get(communityId))) throw new Error("Pick which community it is for.");
    } else if (communityId) {
      throw new Error("That item isn't for a community.");
    }
    if (sku.type === "subscription") {
      throw new Error("Subscriptions are bought, not given — a comp would never renew or end.");
    }
    if (await ownsSku(ctx, userId, skuId, communityId)) throw new Error("They already own that.");

    await grantEntitlements(ctx, {
      userId,
      skuId,
      grants: sku.grants,
      source: "staff",
      communityId,
    });
    await audit(ctx, staff.user._id, "users.grant", { type: "user", id: userId }, `${sku.name} to ${user.username} — ${why}`);
  },
});

export const revokeEntitlement = mutation({
  args: { entitlementId: v.id("entitlements"), reason: v.string() },
  handler: async (ctx, { entitlementId, reason }) => {
    const staff = await requireStaff(ctx, "users.entitle");
    const entitlement = await ctx.db.get(entitlementId);
    if (!entitlement) throw new Error("That item doesn't exist.");
    const why = reason.trim().slice(0, 300);
    if (why.length < 3) throw new Error("Say why this is being taken back.");
    // Paid items are taken back by refunding the order, which also handles the
    // money; revoking one here would leave the buyer charged for nothing.
    if (entitlement.source !== "staff") {
      throw new Error("That was bought. Refund the order to take it back.");
    }
    if (entitlement.revokedAt === undefined) await ctx.db.patch(entitlementId, { revokedAt: Date.now() });
    const user = await ctx.db.get(entitlement.userId);
    await audit(
      ctx,
      staff.user._id,
      "users.revoke",
      { type: "user", id: entitlement.userId },
      `${entitlement.label ?? entitlement.kind} from ${user?.username ?? "unknown"} — ${why}`,
    );
  },
});

// --- Communities ----------------------------------------------------------------

async function communityRow(ctx: QueryCtx, community: Doc<"communities">) {
  const [owner, moderation, members] = await Promise.all([
    ctx.db.get(community.ownerId),
    ctx.db.query("communityModeration").withIndex("by_community", (q) => q.eq("communityId", community._id)).unique(),
    ctx.db.query("communityMembers").withIndex("by_community", (q) => q.eq("communityId", community._id)).take(10_000),
  ]);
  return {
    id: community._id,
    name: community.name,
    imageUrl: community.imageUrl,
    owner: owner?.username ?? "unknown",
    ownerId: community.ownerId,
    memberCount: members.length,
    status: effectiveCommunityStatus(moderation),
    reason: moderation?.reason ?? null,
    until: moderation?.status === "suspended" ? (moderation.until ?? null) : null,
    createdAt: community.createdAt,
  };
}

export const communities = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    await requireStaff(ctx, "communities.read");
    const needle = search?.trim() ?? "";
    const rows = needle
      ? await ctx.db.query("communities").withSearchIndex("search_name", (q) => q.search("name", needle)).take(MAX_RESULTS)
      : await ctx.db.query("communities").order("desc").take(MAX_RESULTS);
    return Promise.all(rows.map((c) => communityRow(ctx, c)));
  },
});

export const communityDetail = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    await requireStaff(ctx, "communities.read");
    const community = await ctx.db.get(communityId);
    if (!community) return null;
    const [row, channels, reports, entitlements] = await Promise.all([
      communityRow(ctx, community),
      ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", communityId)).take(500),
      ctx.db.query("reports").filter((q) => q.eq(q.field("communityId"), communityId)).order("desc").take(30),
      ctx.db.query("entitlements").withIndex("by_community", (q) => q.eq("communityId", communityId)).take(50),
    ]);
    const moderation = await ctx.db
      .query("communityModeration")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .unique();
    return {
      ...row,
      inviteOnly: community.inviteOnly ?? true,
      channelCount: channels.length,
      moderatedBy: moderation ? ((await ctx.db.get(moderation.actorId))?.username ?? null) : null,
      moderatedAt: moderation?.updatedAt ?? null,
      reports: reports.map((r) => ({ id: r._id, category: r.category, status: r.status, createdAt: r.createdAt })),
      items: await Promise.all(
        entitlements.map(async (e) => ({
          id: e._id,
          skuName: (await ctx.db.get(e.skuId))?.name ?? "Removed item",
          kind: e.kind,
          active: isActive(e),
        })),
      ),
    };
  },
});

export const setCommunityStatus = mutation({
  args: {
    communityId: v.id("communities"),
    status: v.union(
      v.literal("active"),
      v.literal("restricted"),
      v.literal("archived"),
      v.literal("suspended"),
      v.literal("banned"),
    ),
    reason: v.optional(v.string()),
    /** Days, for a suspension only; omit for until lifted. */
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // A ban is permanent and closes the community for good, so it asks for what banning a person does.
    const staff = await requireStaff(ctx, args.status === "banned" ? "users.ban" : "communities.manage");
    const community = await ctx.db.get(args.communityId);
    if (!community) throw new Error("Community not found.");
    const reason = args.reason?.trim().slice(0, 500);
    if (args.status !== "active" && (!reason || reason.length < 3)) throw new Error("A reason is required.");
    if (args.days !== undefined && (args.status !== "suspended" || !Number.isFinite(args.days) || args.days <= 0 || args.days > MAX_SUSPENSION_DAYS)) {
      throw new Error(`Only a suspension takes a length, between 1 and ${MAX_SUSPENSION_DAYS} days.`);
    }
    const until = args.status === "suspended" && args.days !== undefined ? Date.now() + Math.round(args.days * 24 * 60 * 60 * 1000) : undefined;
    const existing = await ctx.db
      .query("communityModeration")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .unique();
    // Lifting a ban takes what imposing one does.
    if (existing?.status === "banned" && args.status !== "banned") await requireStaff(ctx, "users.ban");
    const fields = { status: args.status, reason, until, actorId: staff.user._id, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("communityModeration", { communityId: args.communityId, ...fields });
    await audit(
      ctx,
      staff.user._id,
      `communities.${args.status}`,
      { type: "community", id: args.communityId },
      `${community.name}${args.days !== undefined ? ` (${args.days} days)` : ""}${reason ? ` — ${reason}` : ""}`,
    );
  },
});

// --- Search across the console ---------------------------------------------------------

/** One box for "find me that person or community" — what the console's top bar
 * searches. Only what the caller may read is searched. */
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, { query: text }) => {
    const staff = await requireStaff(ctx, "users.read").catch(() => null);
    const needle = text.trim().toLowerCase().replace(/^@/, "");
    if (needle.length < 2) return { users: [], communities: [] };
    const foundUsers = staff
      ? await ctx.db
          .query("users")
          .withIndex("by_username", (q) => q.gte("username", needle).lt("username", `${needle}￿`))
          .take(6)
      : [];
    // Through `requireStaff`, not `getStaff`: this branch has to stop answering for a session that
    // hasn't entered its code, exactly like the users branch above.
    const mayReadCommunities = !!(await requireStaff(ctx, "communities.read").catch(() => null));
    const foundCommunities = mayReadCommunities
      ? await ctx.db.query("communities").withSearchIndex("search_name", (q) => q.search("name", needle)).take(6)
      : [];
    return {
      users: foundUsers.map((u) => ({ id: u._id, name: u.name, username: u.username, imageUrl: u.imageUrl })),
      communities: foundCommunities.map((c) => ({ id: c._id, name: c.name, imageUrl: c.imageUrl })),
    };
  },
});
