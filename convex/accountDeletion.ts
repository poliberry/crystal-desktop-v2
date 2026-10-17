import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { deleteChannelMessage } from "./channelMessages";
import { deleteDmMessage } from "./messages";
import { wipeProfile } from "./lib/accountWipe";
import { removeInstall } from "./lib/botAccess";
import { releaseFile, releaseUrl } from "./lib/files";
import { revokeSessions } from "./lib/sessions";
import { requireFreshVerification } from "./lib/stepUp";
import { getCurrentUserOrThrow } from "./users";

/**
 * Deleting your own account, from Settings → Privacy.
 *
 * `request` does what has to happen at once, in one transaction: it checks you are you (a fresh
 * password or 2FA code, asked for by the client's step-up prompt), signs you out everywhere, removes
 * your email and password so the account can never be signed into again, and wipes your profile and
 * its files. Then a background job (`run`) works through everything else in small batches, because
 * an account can have more rows than one mutation may touch.
 *
 * What is deleted, anonymised and kept is described to users on /privacy and in the privacy policy;
 * keep the three in step:
 *
 * - **Deleted:** messages you wrote in DMs and communities with their attachments and files, your
 *   memberships, friends and requests, blocks, server profiles, profile board, saved messages,
 *   notifications, presence and game history, linked accounts, encryption keys, push tokens and web push subscriptions, IP
 *   records, extension data, and bots you own.
 * - **Anonymised:** the user row becomes "Deleted user". Reactions, forum and AMA posts, LFG posts and
 *   lounge chat (which have no author index to find them by) stay, shown as "Deleted user".
 * - **Kept:** orders, entitlements and creator earnings (tax and accounting), reports and moderation
 *   records (safety), and marketplace items you published that others own.
 */

const BATCH = 100;
/** Smaller batches for messages: each one can carry attachments and reactions. */
const MESSAGE_BATCH = 40;

export type DeletionBlocker =
  | { kind: "communities"; names: string[] }
  | { kind: "earnings" }
  | { kind: "guest" };

async function blockersFor(ctx: QueryCtx, user: Doc<"users">): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];
  if (user.isGuest) blockers.push({ kind: "guest" });
  const owned = await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect();
  if (owned.length) blockers.push({ kind: "communities", names: owned.map((c) => c.name) });
  const earnings = await ctx.db.query("creatorEarnings").withIndex("by_creator", (q) => q.eq("creatorId", user._id)).collect();
  if (earnings.some((e) => e.status === "pending" || e.status === "held")) blockers.push({ kind: "earnings" });
  return blockers;
}

/** What would stop this account being deleted right now, for the Settings screen to explain. */
export const preflight = query({
  args: {},
  handler: async (ctx): Promise<{ blockers: DeletionBlocker[]; username: string } | null> => {
    const user = await getCurrentUserOrThrow(ctx).catch(() => null);
    if (!user) return null;
    return { blockers: await blockersFor(ctx, user), username: user.username };
  },
});

export const request = mutation({
  args: { confirmUsername: v.string() },
  handler: async (ctx, { confirmUsername }) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.deletedAt) return { ok: true as const };
    if (confirmUsername.trim().replace(/^@/, "").toLowerCase() !== user.username.toLowerCase()) {
      throw new ConvexError({ code: "CONFIRM_MISMATCH", message: "That isn't your username." });
    }
    const blockers = await blockersFor(ctx, user);
    if (blockers.length) {
      const first = blockers[0];
      const message =
        first.kind === "guest"
          ? "Guest accounts delete themselves after 24 hours."
          : first.kind === "communities"
            ? `Delete the communities you own first: ${first.names.join(", ")}.`
            : "You have creator earnings waiting to be paid out. Contact support so we can settle them first.";
      throw new ConvexError({ code: "DELETION_BLOCKED", message });
    }
    // A fresh password or 2FA code: the client's step-up prompt asks for it and retries this call.
    await requireFreshVerification(ctx, user._id);

    const now = Date.now();
    await ctx.db.insert("accountDeletions", { userId: user._id, requestedAt: now, step: 0 });

    // Nobody can sign in to it from here on: no sessions, no email, no password, no second factor.
    await revokeSessions(ctx, user._id);
    for (const table of ["userEmails", "authCredentials", "userTwoFactor", "twoFactorBackupCodes", "passkeys", "stepUpGrants"] as const) {
      for (const row of await ctx.db.query(table).withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(row._id);
    }

    await ctx.db.patch(user._id, { deletedAt: now });
    await wipeProfile(ctx, user, { name: "Deleted user", username: `deleted.${user._id.slice(-10).toLowerCase().replace(/[^a-z0-9]/g, "x")}` });

    // Subscriptions stop now rather than at the end of the period: there is no account left to use them.
    await ctx.scheduler.runAfter(0, internal.payments.cancelSubscriptionsForDeletion, { userId: user._id });
    await ctx.scheduler.runAfter(0, internal.accountDeletion.run, { userId: user._id });
    return { ok: true as const };
  },
});

/** Delete up to `limit` rows from a by-user index. Returns whether the table is now done. */
async function deleteByUser<T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  index: string,
  userId: Id<"users">,
  onRow?: (row: Doc<T>) => Promise<void>
): Promise<boolean> {
  // The indexes used here all start with the user id; the casts are what lets one helper cover them.
  const rows = (await ctx.db
    .query(table)
    .withIndex(index as never, ((q: { eq: (field: string, value: unknown) => unknown }) => q.eq("userId", userId)) as never)
    .take(BATCH)) as Doc<T>[];
  for (const row of rows) {
    await ctx.db.delete(row._id as Id<T>);
    if (onRow) await onRow(row);
  }
  return rows.length < BATCH;
}

type Step = (ctx: MutationCtx, userId: Id<"users">) => Promise<boolean>;

/** In order. Each returns true once it has nothing left to do. */
const STEPS: Step[] = [
  // Bots you own: uninstalled everywhere and retired, as `bots.remove` does.
  async (ctx, userId) => {
    const bots = await ctx.db.query("bots").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(5);
    for (const bot of bots) {
      for (const install of await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", bot._id)).collect()) {
        await removeInstall(ctx, install, bot.userId);
      }
      const account = await ctx.db.get(bot.userId);
      await ctx.db.patch(bot.userId, { name: "Deleted bot", imageUrl: undefined, avatarStorageId: undefined, bannerUrl: undefined, bannerStorageId: undefined });
      if (account) {
        await releaseUrl(ctx, account.imageUrl, account.avatarStorageId);
        await releaseUrl(ctx, account.bannerUrl, account.bannerStorageId);
      }
      for (const row of await ctx.db.query("botRate").withIndex("by_bot", (q) => q.eq("botId", bot._id)).collect()) await ctx.db.delete(row._id);
      await ctx.db.delete(bot._id);
    }
    return bots.length < 5;
  },
  // Messages you wrote, with their attachments and files.
  async (ctx, userId) => {
    const rows = await ctx.db.query("messages").withIndex("by_author", (q) => q.eq("authorId", userId)).take(MESSAGE_BATCH);
    for (const row of rows) await deleteDmMessage(ctx, row._id);
    return rows.length < MESSAGE_BATCH;
  },
  async (ctx, userId) => {
    const rows = await ctx.db.query("channelMessages").withIndex("by_author", (q) => q.eq("authorId", userId)).take(MESSAGE_BATCH);
    for (const row of rows) await deleteChannelMessage(ctx, row, userId);
    return rows.length < MESSAGE_BATCH;
  },
  // Communities you belong to, and what hangs off each membership.
  async (ctx, userId) => {
    const rows = await ctx.db.query("communityMembers").withIndex("by_user", (q) => q.eq("userId", userId)).take(20);
    for (const member of rows) {
      const communityId = member.communityId;
      for (const r of await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId)).collect()) await ctx.db.delete(r._id);
      for (const r of await ctx.db.query("clanRoster").withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId)).collect()) await ctx.db.delete(r._id);
      for (const r of await ctx.db.query("creatorMemberships").withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", userId)).collect()) await ctx.db.delete(r._id);
      await ctx.db.delete(member._id);
    }
    return rows.length < 20;
  },
  // Server profiles: the profile wipe already forgot their saved pictures; these are the rows and what they wear.
  async (ctx, userId) => {
    const rows = await ctx.db.query("serverProfiles").withIndex("by_user_community", (q) => q.eq("userId", userId)).take(BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
      for (const [url, storageId] of [
        [row.imageUrl, row.avatarStorageId],
        [row.avatarOriginalUrl, row.avatarOriginalStorageId],
        [row.bannerUrl, row.bannerStorageId],
        [row.bannerOriginalUrl, row.bannerOriginalStorageId],
        [row.nameplateUrl, row.nameplateStorageId],
        [row.profileEffect, row.profileEffectStorageId],
        [row.profileFrame, row.profileFrameStorageId],
      ] as const) {
        await releaseUrl(ctx, url, storageId);
      }
    }
    return rows.length < BATCH;
  },
  (ctx, userId) =>
    deleteByUser(ctx, "profileWidgets", "by_user", userId, async (row) => {
      await releaseUrl(ctx, row.imageUrl, row.imageStorageId);
      for (const f of row.fields ?? []) if (f.kind === "image") await releaseFile(ctx, { cdnUrl: f.value, storageId: f.storageId });
    }),
  // DM memberships stay, so the other person's conversation reads "Deleted user" rather than losing its
  // other side. They hold no personal data; the user row they point at has been wiped.
  // Friends, both directions.
  async (ctx, userId) => {
    const rows = await ctx.db.query("friendships").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(BATCH);
    for (const row of rows) {
      const reverse = await ctx.db.query("friendships").withIndex("by_owner_friend", (q) => q.eq("ownerId", row.friendId).eq("friendId", userId)).collect();
      for (const r of reverse) await ctx.db.delete(r._id);
      await ctx.db.delete(row._id);
    }
    return rows.length < BATCH;
  },
  async (ctx, userId) => {
    const sent = await ctx.db.query("friendRequests").withIndex("by_requester", (q) => q.eq("requesterId", userId)).take(BATCH);
    const received = await ctx.db.query("friendRequests").withIndex("by_recipient", (q) => q.eq("recipientId", userId)).take(BATCH);
    for (const row of [...sent, ...received]) await ctx.db.delete(row._id);
    return sent.length < BATCH && received.length < BATCH;
  },
  (ctx, userId) => deleteByUser(ctx, "userSuppressions", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "presence", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "presenceSessions", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "gameHistory", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "devicePushTokens", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "webPushSubscriptions", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "notifications", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "priorityItems", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "notificationSettings", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "communityNotificationSettings", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "sidebarCommunityOrders", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "klipyFavourites", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "savedMessages", "by_user_created", userId),
  (ctx, userId) => deleteByUser(ctx, "channelReads", "by_user_channel", userId),
  (ctx, userId) => deleteByUser(ctx, "typing", "by_user_channel", userId),
  (ctx, userId) => deleteByUser(ctx, "typing", "by_user_conversation", userId),
  (ctx, userId) => deleteByUser(ctx, "extensionInstalls", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "extensionStorage", "by_user_extension", userId),
  (ctx, userId) => deleteByUser(ctx, "extensionHttpLog", "by_user_extension_at", userId),
  (ctx, userId) => deleteByUser(ctx, "connectedAccounts", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "e2eeIdentities", "by_user", userId),
  (ctx, userId) => deleteByUser(ctx, "e2eeKeyWraps", "by_user", userId),
  (ctx, userId) =>
    deleteByUser(ctx, "callParticipants", "by_user", userId, (row) => releaseUrl(ctx, row.streamThumbnailUrl, row.streamThumbnailStorageId)),
  (ctx, userId) =>
    deleteByUser(ctx, "channelCallParticipants", "by_user", userId, (row) => releaseUrl(ctx, row.streamThumbnailUrl, row.streamThumbnailStorageId)),
  async (ctx, userId) => {
    const rows = await ctx.db.query("callRings").withIndex("by_recipient", (q) => q.eq("recipientId", userId)).take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length < BATCH;
  },
  async (ctx, userId) => {
    const rows = await ctx.db.query("communityTemplates").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length < BATCH;
  },
  (ctx, userId) => deleteByUser(ctx, "userIps", "by_user_seen", userId),
];

export const run = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const job = await ctx.db.query("accountDeletions").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!job || job.finishedAt) return;
    let step = job.step;
    // One step's batch per run keeps each transaction small; the job reschedules itself until done.
    if (step < STEPS.length) {
      const done = await STEPS[step](ctx, userId);
      if (done) step++;
    }
    if (step >= STEPS.length) {
      await ctx.db.patch(job._id, { step, finishedAt: Date.now() });
      return;
    }
    await ctx.db.patch(job._id, { step });
    await ctx.scheduler.runAfter(0, internal.accountDeletion.run, { userId });
  },
});
