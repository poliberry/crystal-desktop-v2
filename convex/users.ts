import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { visibleActivities, visibleCustomStatus } from "./lib/activities";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

export async function getCurrentUserOrNull(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function getCurrentUserOrThrow(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new Error("Not authenticated, or user has not been bootstrapped yet.");
  return user;
}

function deriveUsername(identity: { nickname?: string; email?: string; givenName?: string }): string {
  const base = identity.nickname ?? identity.email?.split("@")[0] ?? identity.givenName ?? "user";
  return base.toLowerCase().replace(/[^a-z0-9_.]/g, "");
}

/**
 * Creates the Convex user row from the Clerk identity the first time someone
 * signs in. Deliberately does NOT patch an existing row's `name`/`imageUrl`
 * from Clerk on every call — once a profile exists, display name, avatar,
 * username and bio are independently editable via `updateProfile`/
 * `setAvatar` below, and re-syncing from Clerk here would silently clobber
 * whatever the user customized.
 *
 * The one thing it does re-check on every sign-in is the Poliberry Staff badge
 * (see `syncStaffBadge`), because that follows from the account's email rather
 * than from anything the user edits.
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (existing) {
      await syncStaffBadge(ctx, existing._id, identity.email);
      return existing._id;
    }

    const name = identity.name ?? identity.nickname ?? identity.email ?? "New user";
    const imageUrl = typeof identity.pictureUrl === "string" ? identity.pictureUrl : undefined;

    let username = deriveUsername(identity) || "user";
    let suffix = 0;
    while (
      await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique()
    ) {
      suffix += 1;
      username = `${deriveUsername(identity) || "user"}${suffix}`;
    }

    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      name,
      username,
      imageUrl,
    });
    await syncStaffBadge(ctx, userId, identity.email);
    return userId;
  },
});

const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;
const NAME_MAX = 64;
const BIO_MAX = 300;

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, { name, username, bio }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const patch: { name?: string; username?: string; bio?: string } = {};

    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Display name can't be empty.");
      if (trimmed.length > NAME_MAX) throw new Error(`Display name must be ${NAME_MAX} characters or fewer.`);
      patch.name = trimmed;
    }

    if (username !== undefined) {
      const normalized = username.trim().toLowerCase();
      if (!USERNAME_RE.test(normalized)) {
        throw new Error('Usernames are 3-32 characters: lowercase letters, numbers, "." or "_".');
      }
      if (normalized !== me.username) {
        const clash = await ctx.db
          .query("users")
          .withIndex("by_username", (q) => q.eq("username", normalized))
          .unique();
        if (clash && clash._id !== me._id) throw new Error("That username is taken.");
      }
      patch.username = normalized;
    }

    if (bio !== undefined) {
      const trimmed = bio.trim();
      if (trimmed.length > BIO_MAX) throw new Error(`Bio must be ${BIO_MAX} characters or fewer.`);
      patch.bio = trimmed;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(me._id, patch);
    }
    // Returns the actual persisted (trimmed/normalized) values, not just the
    // id — the caller's local form state should mirror exactly what got
    // saved, not whatever untrimmed/differently-cased text was submitted.
    return {
      id: me._id,
      name: patch.name ?? me.name,
      username: patch.username ?? me.username,
      bio: patch.bio ?? me.bio ?? "",
    };
  },
});

export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Set (or clear) the custom status, with an optional deadline.
 *
 * Separate from `updateProfileExtended` because of the deadline: that mutation
 * patches whichever cosmetic fields it was given, and "clear after 2 hours"
 * has to write two fields together or not at all. An empty `text` clears both.
 *
 * The text itself is never deleted just because the user goes offline — that's
 * a display rule applied on read (see `visibleCustomStatus`), so "Back Monday"
 * is still there when they come back.
 */
export const setCustomStatus = mutation({
  args: {
    text: v.string(),
    /** How long it should last. Omitted means "until I clear it". */
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, { text, durationMs }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const trimmed = text.trim().slice(0, 128);
    await ctx.db.patch(me._id, {
      customStatus: trimmed || undefined,
      customStatusExpiresAt: trimmed && durationMs ? Date.now() + durationMs : undefined,
    });
  },
});

export const updateProfileExtended = mutation({
  args: {
    customStatus: v.optional(v.string()),
    borderGradientStart: v.optional(v.string()),
    borderGradientEnd: v.optional(v.string()),
    profileBg: v.optional(v.string()),
    /** `YYYY-MM-DD`, or empty to clear it. */
    dob: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const patch: Record<string, string | number | undefined> = {};
    if (args.dob !== undefined) {
      const dob = args.dob.trim();
      // Anything that isn't `YYYY-MM-DD` is rejected rather than stored and
      // silently ignored later: the birthday check splits on the dashes, so a
      // malformed value would just never match and look like a bug in the
      // greeting instead of in the field that set it.
      if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        throw new Error("Date of birth must be in YYYY-MM-DD form.");
      }
      patch.dob = dob || undefined;
    }
    if (args.customStatus !== undefined) {
      patch.customStatus = args.customStatus.trim().slice(0, 128) || undefined;
      // A status written without a deadline replaces one that had one, rather
      // than inheriting its expiry and vanishing at someone else's schedule.
      patch.customStatusExpiresAt = undefined;
    }
    if (args.borderGradientStart !== undefined) patch.borderGradientStart = args.borderGradientStart || undefined;
    if (args.borderGradientEnd !== undefined) patch.borderGradientEnd = args.borderGradientEnd || undefined;
    if (args.profileBg !== undefined) patch.profileBg = args.profileBg || undefined;
    if (Object.keys(patch).length > 0) await ctx.db.patch(me._id, patch);
  },
});

/** As `setAvatar`, for the profile banner. */
export const setBanner = mutation({
  args: {
    storageId: v.id("_storage"),
    originalStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { storageId, originalStorageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Banner upload failed.");
    const originalUrl = originalStorageId ? await ctx.storage.getUrl(originalStorageId) : null;

    const previous = me.bannerStorageId;
    const previousOriginal = me.bannerOriginalStorageId;
    await ctx.db.patch(me._id, {
      bannerUrl: url,
      bannerStorageId: storageId,
      ...(originalStorageId
        ? { bannerOriginalStorageId: originalStorageId, bannerOriginalUrl: originalUrl ?? undefined }
        : {}),
    });
    if (
      originalStorageId &&
      previousOriginal &&
      previousOriginal !== originalStorageId &&
      previousOriginal !== storageId
    ) {
      await ctx.storage.delete(previousOriginal);
    }
    if (previous && previous !== storageId && previous !== me.bannerOriginalStorageId) {
      await ctx.storage.delete(previous);
    }
    return url;
  },
});

export const removeBanner = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const previous = me.bannerStorageId;
    const previousOriginal = me.bannerOriginalStorageId;
    await ctx.db.patch(me._id, {
      bannerUrl: undefined,
      bannerStorageId: undefined,
      bannerOriginalUrl: undefined,
      bannerOriginalStorageId: undefined,
    });
    if (previous && previous !== previousOriginal) await ctx.storage.delete(previous);
    if (previousOriginal) await ctx.storage.delete(previousOriginal);
  },
});

export const setNameplate = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Nameplate upload failed.");
    const previous = me.nameplateStorageId;
    await ctx.db.patch(me._id, { nameplateUrl: url, nameplateStorageId: storageId });
    if (previous && previous !== storageId) await ctx.storage.delete(previous);
    return url;
  },
});

export const removeNameplate = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const previous = me.nameplateStorageId;
    await ctx.db.patch(me._id, { nameplateUrl: undefined, nameplateStorageId: undefined });
    if (previous) await ctx.storage.delete(previous);
  },
});

/** Whether a storage object is still in use as a message attachment (DM or
 * channel) — an avatar's previous storage id shouldn't be deleted out from
 * under an attachment that happens to point at the same object (e.g. a
 * client passing setAvatar an existing attachment's storageId instead of a
 * fresh upload from generateAvatarUploadUrl). */
async function isReferencedByAttachment(ctx: MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  const [dmAttachment, channelAttachment] = await Promise.all([
    ctx.db
      .query("messageAttachments")
      .filter((q) => q.eq(q.field("storageId"), storageId))
      .first(),
    ctx.db
      .query("channelMessageAttachments")
      .filter((q) => q.eq(q.field("storageId"), storageId))
      .first(),
  ]);
  return !!dmAttachment || !!channelAttachment;
}

/**
 * Set the avatar to a freshly-cropped render.
 *
 * `originalStorageId` accompanies a *new* picture and is the uncropped upload
 * it came from, kept so the crop stays adjustable later without asking for
 * the file again. Re-cropping an image already on the profile omits it, which
 * means "keep the original I already have" rather than "there isn't one".
 */
export const setAvatar = mutation({
  args: {
    storageId: v.id("_storage"),
    /** The uncropped upload this crop came from. Omitted when re-cropping an
     * image already on the profile. */
    originalStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { storageId, originalStorageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Avatar upload failed.");
    const originalUrl = originalStorageId ? await ctx.storage.getUrl(originalStorageId) : null;

    const previous = me.avatarStorageId;
    const previousOriginal = me.avatarOriginalStorageId;
    // Drop the cached accent colour: it describes the old picture. The
    // client re-samples and calls `setAvatarAccent` with the new one.
    await ctx.db.patch(me._id, {
      imageUrl: url,
      avatarStorageId: storageId,
      avatarAccent: undefined,
      avatarAccentUrl: undefined,
      ...(originalStorageId
        ? { avatarOriginalStorageId: originalStorageId, avatarOriginalUrl: originalUrl ?? undefined }
        : {}),
    });
    if (
      originalStorageId &&
      previousOriginal &&
      previousOriginal !== originalStorageId &&
      previousOriginal !== storageId &&
      !(await isReferencedByAttachment(ctx, previousOriginal))
    ) {
      await ctx.storage.delete(previousOriginal);
    }
    if (
      previous &&
      previous !== storageId &&
      // The old crop can be the original itself, for an avatar uploaded
      // before cropping existed — deleting it would take the source with it.
      previous !== me.avatarOriginalStorageId &&
      !(await isReferencedByAttachment(ctx, previous))
    ) {
      // Not caught: a failed delete should abort the whole mutation (Convex
      // mutations are all-or-nothing) rather than silently commit the avatar
      // change while leaving the old object undeleted-but-unreferenced.
      await ctx.storage.delete(previous);
    }
    return url;
  },
});

/**
 * Cache the dominant colour of my avatar, as sampled by my own client.
 *
 * `sourceUrl` is the avatar the colour was taken from: if it no longer
 * matches, the avatar changed while the sample was in flight and the result
 * is dropped rather than written as a colour for the wrong picture. Nobody
 * writes anyone else's — every client samples its own avatar once and the
 * value is then read by everybody (see `getUsersByIds`).
 */
export const setAvatarAccent = mutation({
  args: { accent: v.string(), sourceUrl: v.string() },
  handler: async (ctx, { accent, sourceUrl }) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (me.imageUrl !== sourceUrl) return;
    await ctx.db.patch(me._id, { avatarAccent: accent, avatarAccentUrl: sourceUrl });
  },
});

export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const previous = me.avatarStorageId;
    await ctx.db.patch(me._id, {
      imageUrl: undefined,
      avatarStorageId: undefined,
      avatarAccent: undefined,
      avatarAccentUrl: undefined,
    });
    if (previous && !(await isReferencedByAttachment(ctx, previous))) {
      await ctx.storage.delete(previous);
    }
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => getCurrentUserOrNull(ctx),
});

export const getProfile = query({
  args: { userId: v.id("users"), communityId: v.optional(v.id("communities")) },
  handler: async (ctx, { userId, communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    // Community context: a per-server nickname/avatar and the member's roles,
    // so the card shows the same identity the channel does.
    let serverProfile = null;
    let roles: { id: Id<"roles">; name: string; color?: string }[] = [];
    let isOwner = false;
    if (communityId) {
      const community = await ctx.db.get(communityId);
      isOwner = community?.ownerId === userId;
      const [profile, assigned] = await Promise.all([
        ctx.db
          .query("serverProfiles")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", userId).eq("communityId", communityId)
          )
          .unique(),
        ctx.db
          .query("memberRoles")
          .withIndex("by_member", (q) =>
            q.eq("communityId", communityId).eq("userId", userId)
          )
          .collect(),
      ]);
      serverProfile = profile;
      const resolved = await Promise.all(assigned.map((m) => ctx.db.get(m.roleId)));
      roles = resolved
        .filter((r): r is Doc<"roles"> => !!r && !r.isEveryone)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r._id, name: r.name, color: r.color }));
    }

    return {
      id: user._id,
      createdAt: user._creationTime,
      name: serverProfile?.displayName ?? user.name,
      username: user.username,
      imageUrl: serverProfile?.imageUrl ?? user.imageUrl,
      bio: serverProfile?.bio ?? user.bio,
      bannerUrl: serverProfile?.bannerUrl ?? user.bannerUrl,
      customStatus: visibleCustomStatus(
        user,
        presence?.effective ?? "offline",
        serverProfile?.customStatus
      ),
      borderGradientStart: serverProfile?.borderGradientStart ?? user.borderGradientStart,
      borderGradientEnd: serverProfile?.borderGradientEnd ?? user.borderGradientEnd,
      status: presence?.effective ?? "offline",
      activities: visibleActivities(presence, user),
      roles,
      isOwner,
    };
  },
});

/**
 * Names and avatars for a set of users, in one round trip.
 *
 * Pass `communityId` to resolve them the way that community sees them —
 * per-server nickname and avatar where set, falling back field by field to
 * the global profile. Omit it in DM contexts, which have no server identity.
 */
export const getUsersByIds = query({
  args: {
    userIds: v.array(v.id("users")),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, { userIds, communityId }) => {
    if (userIds.length === 0) return [];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    return Promise.all(
      users
        .filter((u): u is NonNullable<typeof u> => u !== null)
        .map(async (u) => {
          const serverProfile = communityId
            ? await ctx.db
                .query("serverProfiles")
                .withIndex("by_user_community", (q) =>
                  q.eq("userId", u._id).eq("communityId", communityId)
                )
                .unique()
            : null;
          // The accent has to come from whichever avatar actually won, not
          // be merged field by field — a server avatar's colour paired with
          // the global picture would just be wrong.
          const usingServerAvatar = !!serverProfile?.imageUrl;
          return {
            id: u._id,
            name: serverProfile?.displayName ?? u.name,
            imageUrl: serverProfile?.imageUrl ?? u.imageUrl,
            avatarAccent: usingServerAvatar ? serverProfile.avatarAccent : u.avatarAccent,
          };
        })
    );
  },
});

export const searchByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const me = await getCurrentUserOrNull(ctx);
    const normalized = username.trim().toLowerCase();
    if (!normalized || !me) return null;
    const match = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (!match || match._id === me._id) return null;
    return { id: match._id, name: match.name, username: match.username, imageUrl: match.imageUrl };
  },
});

/** Resolves the caller's Convex user id from a `"use node"` action, which
 * can't touch `ctx.db` itself (see callTokens.ts / channelCalls.ts's `leave` actions). */
export const getCurrentUserIdInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    return me?._id ?? null;
  },
});

// --- Badges ----------------------------------------------------------------

/**
 * A user's badges, oldest first.
 *
 * Fetched by the profile card itself rather than joined into every query that
 * returns a member: the card is opened one at a time, and the alternative is
 * threading a `badges` field through half a dozen unrelated queries so that
 * one popover can render a row of pills.
 */
export const badgesOf = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("userBadges")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => a.grantedAt - b.grantedAt)
      .map((row) => ({ badgeId: row.badgeId, grantedAt: row.grantedAt }));
  },
});

/**
 * Give someone a badge, unless they already have it.
 *
 * A plain helper rather than a mutation: badges are granted as a consequence
 * of something else happening, so this runs inside whatever transaction
 * decided it was earned.
 */
export async function grantBadge(
  ctx: MutationCtx,
  userId: Id<"users">,
  badgeId: string
): Promise<void> {
  const existing = await ctx.db
    .query("userBadges")
    .withIndex("by_user_badge", (q) => q.eq("userId", userId).eq("badgeId", badgeId))
    .unique();
  if (existing) return;
  await ctx.db.insert("userBadges", { userId, badgeId, grantedAt: Date.now() });
}

/** Take a badge away, if they have it. The counterpart to `grantBadge`. */
export async function revokeBadge(
  ctx: MutationCtx,
  userId: Id<"users">,
  badgeId: string
): Promise<void> {
  const existing = await ctx.db
    .query("userBadges")
    .withIndex("by_user_badge", (q) => q.eq("userId", userId).eq("badgeId", badgeId))
    .unique();
  if (existing) await ctx.db.delete(existing._id);
}

/** Accounts on this email domain are Poliberry staff. */
const STAFF_EMAIL_DOMAIN = "@staff.poliberry.com";

/**
 * Give (or keep) the Poliberry Staff badge to anyone signing in with a staff
 * email.
 *
 * Derived from the Clerk identity rather than granted by hand, so the badge
 * can't drift from who actually works here — and re-checked on every
 * `ensureUser` rather than only at signup, so someone who joins later doesn't
 * need a migration. Clerk verifies the address before it reaches us, so the
 * domain is a claim we can trust.
 *
 * Deliberately grant-only: revoking is `setBadge` below, run by hand, because
 * a missing `email` claim (a JWT template that stops including one) would
 * otherwise strip the badge from every staff account at once.
 */
async function syncStaffBadge(
  ctx: MutationCtx,
  userId: Id<"users">,
  email: string | undefined
): Promise<void> {
  if (!email?.toLowerCase().endsWith(STAFF_EMAIL_DOMAIN)) return;
  await grantBadge(ctx, userId, "poliberry_staff");
}

/**
 * Grant or revoke a badge by username — the manual escape hatch.
 *
 * Run by hand for the cases the automatic rule can't see: a staff member whose
 * account predates the email domain, or one who has left.
 */
export const setBadge = internalMutation({
  args: { username: v.string(), badgeId: v.string(), granted: v.boolean() },
  handler: async (ctx, { username, badgeId, granted }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username.trim().toLowerCase()))
      .unique();
    if (!user) throw new Error(`No user with username "${username}".`);
    if (granted) await grantBadge(ctx, user._id, badgeId);
    else await revokeBadge(ctx, user._id, badgeId);
    return { userId: user._id, badgeId, granted };
  },
});

/**
 * One-off: give everyone who already had an account the Early Supporter badge.
 *
 * Run by hand (`npx convex run users:grantEarlySupporterToExistingUsers`)
 * rather than on sign-in, because "was here early" is a fact about the past —
 * deciding it from a cutoff date at sign-in time would mean picking a date,
 * and the set of accounts that existed when this shipped is the honest answer.
 * Idempotent, so running it twice is harmless.
 */
export const grantEarlySupporterToExistingUsers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let granted = 0;
    for (const user of users) {
      const existing = await ctx.db
        .query("userBadges")
        .withIndex("by_user_badge", (q) =>
          q.eq("userId", user._id).eq("badgeId", "early_supporter")
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("userBadges", {
        userId: user._id,
        badgeId: "early_supporter",
        // Their account's creation time, not now: the badge is about when they
        // showed up, and "Early Supporter since today" would be nonsense.
        grantedAt: user._creationTime,
      });
      granted++;
    }
    return { users: users.length, granted };
  },
});
