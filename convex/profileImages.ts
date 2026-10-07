import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireMember } from "./communities";
import { resolveProfileAsset } from "./lib/profileCosmetics";
import { isR2Url, dropR2Url, r2PublicUrlForKey } from "./lib/r2";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * The pictures behind a profile — avatar, banner and nameplate — and the short
 * list of ones recently worn.
 *
 * ## One path for both profiles
 *
 * The account and each server identity carry these three pictures in
 * identically-named fields (`imageUrl`, `bannerUrl`, `nameplateUrl` and their
 * storage ids), which used to be written by six near-identical pairs of
 * mutations, one pair per kind per profile. Setting, removing and restoring are
 * one function each here, parameterised by the kind and by an optional
 * community, so there is one place that knows what "replace an avatar" means.
 *
 * ## The files belong to the history
 *
 * Replacing a picture used to delete the one it replaced. With a list of
 * recent pictures to go back to, that would leave the list pointing at nothing,
 * so now nothing is deleted at the moment of replacement. Each picture has a row
 * in `profileImages`, and its files go when its row falls off the end of the
 * list — and only if no other row and no current profile still points at them,
 * since re-cropping a picture makes a new row that shares the original with the
 * old one.
 *
 * ## CDN first
 *
 * Pictures arrive either as an R2 object (`cdnKey` / `cdnUrl`, public on
 * Cloudflare's network) or, where R2 isn't configured, as a Convex storage id.
 * Either way what is stored is a URL, so reads never have to ask which.
 */

export const RECENT_LIMIT = 5;

const kindValidator = v.union(v.literal("avatar"), v.literal("banner"), v.literal("nameplate"));
type ImageKind = "avatar" | "banner" | "nameplate";

/** Which fields of a profile document hold each kind. The same names on the
 * user and on a server profile — which is what lets one function write both. */
const FIELDS = {
  avatar: {
    url: "imageUrl",
    storage: "avatarStorageId",
    originalUrl: "avatarOriginalUrl",
    originalStorage: "avatarOriginalStorageId",
  },
  banner: {
    url: "bannerUrl",
    storage: "bannerStorageId",
    originalUrl: "bannerOriginalUrl",
    originalStorage: "bannerOriginalStorageId",
  },
  nameplate: {
    url: "nameplateUrl",
    storage: "nameplateStorageId",
    originalUrl: undefined,
    originalStorage: undefined,
  },
} as const;

/** A profile document read loosely: the user's and a server profile's share the
 * field names above, but not a type. */
type ProfileDoc = Record<string, unknown> & { _id: Id<"users"> | Id<"serverProfiles"> };

/** The document being edited — the user's own, or their identity in a server
 * (absent until they have made one). */
async function loadTarget(
  ctx: QueryCtx,
  me: Doc<"users">,
  communityId: Id<"communities"> | undefined
): Promise<ProfileDoc | null> {
  if (!communityId) return me as unknown as ProfileDoc;
  return (await ctx.db
    .query("serverProfiles")
    .withIndex("by_user_community", (q) => q.eq("userId", me._id).eq("communityId", communityId))
    .unique()) as unknown as ProfileDoc | null;
}

/** What a stored or incoming picture needs to be: where it is, and where its
 * file lives so the file can be dropped later. */
interface Asset {
  url: string;
  storageId?: Id<"_storage">;
}

async function resolveAsset(
  ctx: MutationCtx,
  input: { storageId?: Id<"_storage">; cdnKey?: string; cdnUrl?: string },
  what: string,
  checkSize: boolean
): Promise<Asset> {
  if (input.cdnKey || input.cdnUrl) {
    const url = input.cdnUrl ?? (input.cdnKey ? r2PublicUrlForKey(input.cdnKey) : "");
    if (!url) throw new Error(`${what} upload failed.`);
    return { url };
  }
  if (!input.storageId) throw new Error(`${what} upload failed: nothing was uploaded.`);
  const url = checkSize
    ? await resolveProfileAsset(ctx, input.storageId, what)
    : await ctx.storage.getUrl(input.storageId);
  if (!url) throw new Error(`${what} upload failed.`);
  return { url, storageId: input.storageId };
}

const LABEL: Record<ImageKind, string> = {
  avatar: "Avatar",
  banner: "Banner",
  nameplate: "Nameplate",
};

// --- The history -------------------------------------------------------------

async function rowsFor(
  ctx: QueryCtx,
  userId: Id<"users">,
  kind: ImageKind,
  communityId: Id<"communities"> | undefined
): Promise<Doc<"profileImages">[]> {
  const rows = await ctx.db
    .query("profileImages")
    .withIndex("by_scope", (q) =>
      q.eq("userId", userId).eq("kind", kind).eq("communityId", communityId)
    )
    .collect();
  return rows.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** Whether anything other than `excluding` still points at this file: another
 * row, or a profile that is wearing it right now. */
async function isReferenced(
  ctx: MutationCtx,
  userId: Id<"users">,
  ref: { url?: string; storageId?: Id<"_storage"> },
  excluding: Id<"profileImages">
): Promise<boolean> {
  const rows = await ctx.db
    .query("profileImages")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of rows) {
    if (row._id === excluding) continue;
    if (ref.url && (row.url === ref.url || row.originalUrl === ref.url)) return true;
    if (
      ref.storageId &&
      (row.storageId === ref.storageId || row.originalStorageId === ref.storageId)
    ) {
      return true;
    }
  }

  const profiles: ProfileDoc[] = [];
  const user = await ctx.db.get(userId);
  if (user) profiles.push(user as unknown as ProfileDoc);
  const servers = await ctx.db
    .query("serverProfiles")
    .withIndex("by_user_community", (q) => q.eq("userId", userId))
    .collect();
  profiles.push(...(servers as unknown as ProfileDoc[]));

  for (const profile of profiles) {
    for (const field of Object.values(FIELDS)) {
      for (const key of [field.url, field.storage, field.originalUrl, field.originalStorage]) {
        if (!key) continue;
        const value = profile[key];
        if (value && (value === ref.url || value === ref.storageId)) return true;
      }
    }
  }
  return false;
}

/** Delete the files a row owned — the displayed picture and the original — but
 * not ones something else still uses. */
async function dropRowFiles(ctx: MutationCtx, row: Doc<"profileImages">): Promise<void> {
  const files: { url?: string; storageId?: Id<"_storage"> }[] = [
    { url: row.url, storageId: row.storageId },
  ];
  if (row.originalUrl && row.originalUrl !== row.url) {
    files.push({ url: row.originalUrl, storageId: row.originalStorageId });
  }
  for (const file of files) {
    if (await isReferenced(ctx, row.userId, file, row._id)) continue;
    if (file.storageId) await ctx.storage.delete(file.storageId).catch(() => {});
    if (file.url && isR2Url(file.url)) await dropR2Url(ctx, file.url).catch(() => {});
  }
}

/** Put a picture at the front of its list — new, or moved up if it is already
 * there — and let the oldest fall off the end. */
async function record(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: ImageKind,
  communityId: Id<"communities"> | undefined,
  image: Asset & { originalUrl?: string; originalStorageId?: Id<"_storage"> },
  lastUsedAt: number
): Promise<void> {
  const rows = await rowsFor(ctx, userId, kind, communityId);
  const existing = rows.find((row) => row.url === image.url);
  if (existing) {
    await ctx.db.patch(existing._id, {
      lastUsedAt,
      originalUrl: image.originalUrl ?? existing.originalUrl,
      originalStorageId: image.originalStorageId ?? existing.originalStorageId,
    });
  } else {
    await ctx.db.insert("profileImages", {
      userId,
      kind,
      communityId,
      url: image.url,
      storageId: image.storageId,
      originalUrl: image.originalUrl,
      originalStorageId: image.originalStorageId,
      lastUsedAt,
    });
  }

  const fresh = await rowsFor(ctx, userId, kind, communityId);
  for (const row of fresh.slice(RECENT_LIMIT)) {
    await ctx.db.delete(row._id);
    await dropRowFiles(ctx, row);
  }
}

/** The picture being worn now, as an asset — or `null` if there is none. */
function currentOf(
  profile: ProfileDoc | null,
  kind: ImageKind
): (Asset & { originalUrl?: string; originalStorageId?: Id<"_storage"> }) | null {
  if (!profile) return null;
  const fields = FIELDS[kind];
  const url = profile[fields.url] as string | undefined;
  if (!url) return null;
  return {
    url,
    storageId: profile[fields.storage] as Id<"_storage"> | undefined,
    originalUrl: fields.originalUrl ? (profile[fields.originalUrl] as string | undefined) : undefined,
    originalStorageId: fields.originalStorage
      ? (profile[fields.originalStorage] as Id<"_storage"> | undefined)
      : undefined,
  };
}

/** Make sure the picture about to be replaced has a row, so replacing it doesn't
 * orphan its files. A picture set before this list existed is the case: it was
 * never recorded, and would otherwise be dropped from the account with nothing
 * left to clean it up. Dated just before now so the new picture sorts first. */
async function rememberCurrent(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: ImageKind,
  communityId: Id<"communities"> | undefined,
  profile: ProfileDoc | null,
  now: number
) {
  const current = currentOf(profile, kind);
  if (!current) return;
  const rows = await rowsFor(ctx, userId, kind, communityId);
  if (rows.some((row) => row.url === current.url)) return;
  await record(ctx, userId, kind, communityId, current, now - 1);
}

/** The fields to write to a profile for a picture — and to clear when it's
 * `null`. The accent colour is sampled from an avatar, so a new one invalidates
 * it. */
function fieldsFor(
  kind: ImageKind,
  image: (Asset & { originalUrl?: string; originalStorageId?: Id<"_storage"> }) | null,
  keepOriginal: boolean
): Record<string, unknown> {
  const fields = FIELDS[kind];
  const patch: Record<string, unknown> = {
    [fields.url]: image?.url,
    [fields.storage]: image?.storageId,
  };
  if (fields.originalUrl && fields.originalStorage && !keepOriginal) {
    patch[fields.originalUrl] = image?.originalUrl;
    patch[fields.originalStorage] = image?.originalStorageId;
  }
  if (kind === "avatar") {
    patch.avatarAccent = undefined;
    patch.avatarAccentUrl = undefined;
  }
  return patch;
}

/** Write to a profile, making a server profile if it is the first thing set on
 * one. */
async function writeProfile(
  ctx: MutationCtx,
  me: Doc<"users">,
  communityId: Id<"communities"> | undefined,
  profile: ProfileDoc | null,
  patch: Record<string, unknown>
) {
  if (!communityId) {
    await ctx.db.patch(me._id, patch);
    return;
  }
  if (profile) {
    await ctx.db.patch(profile._id as Id<"serverProfiles">, patch);
    return;
  }
  await ctx.db.insert("serverProfiles", { userId: me._id, communityId, ...patch } as never);
}

// --- Public API --------------------------------------------------------------

/**
 * Wear a newly uploaded picture.
 *
 * `original` is the untouched upload the crop was cut from, present for a fresh
 * pick and absent when an existing picture is re-cropped — in which case the
 * profile keeps the original it already has, and the new crop is recorded
 * against it.
 */
export const set = mutation({
  args: {
    kind: kindValidator,
    communityId: v.optional(v.id("communities")),
    storageId: v.optional(v.id("_storage")),
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
    originalStorageId: v.optional(v.id("_storage")),
    originalCdnKey: v.optional(v.string()),
    originalCdnUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (args.communityId) await requireMember(ctx, args.communityId, me._id);
    const { kind, communityId } = args;

    const picture = await resolveAsset(ctx, args, LABEL[kind], kind === "nameplate");
    const hasOriginal = !!(args.originalStorageId || args.originalCdnKey || args.originalCdnUrl);
    const original = hasOriginal
      ? await resolveAsset(
          ctx,
          {
            storageId: args.originalStorageId,
            cdnKey: args.originalCdnKey,
            cdnUrl: args.originalCdnUrl,
          },
          LABEL[kind],
          false
        )
      : null;

    const profile = await loadTarget(ctx, me, communityId);
    const now = Date.now();
    await rememberCurrent(ctx, me._id, kind, communityId, profile, now);

    const previous = currentOf(profile, kind);
    const image = {
      ...picture,
      // A re-crop keeps the original the profile already has.
      originalUrl: original?.url ?? previous?.originalUrl,
      originalStorageId: original?.storageId ?? previous?.originalStorageId,
    };

    await writeProfile(ctx, me, communityId, profile, fieldsFor(kind, image, !hasOriginal));
    await record(ctx, me._id, kind, communityId, image, now);
    return picture.url;
  },
});

/** Stop wearing a picture. It stays in the list — taking a banner off is not
 * throwing it away — and goes when it is pushed out of it. */
export const remove = mutation({
  args: { kind: kindValidator, communityId: v.optional(v.id("communities")) },
  handler: async (ctx, { kind, communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (communityId) await requireMember(ctx, communityId, me._id);
    const profile = await loadTarget(ctx, me, communityId);
    if (!profile) return;
    await rememberCurrent(ctx, me._id, kind, communityId, profile, Date.now());
    await writeProfile(ctx, me, communityId, profile, fieldsFor(kind, null, false));
  },
});

/** Wear a picture from the list again. */
export const applyRecent = mutation({
  args: { id: v.id("profileImages") },
  handler: async (ctx, { id }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== me._id) throw new Error("That picture isn't in your history.");
    if (row.communityId) await requireMember(ctx, row.communityId, me._id);

    const profile = await loadTarget(ctx, me, row.communityId);
    const now = Date.now();
    await rememberCurrent(ctx, me._id, row.kind, row.communityId, profile, now - 1);

    await writeProfile(
      ctx,
      me,
      row.communityId,
      profile,
      fieldsFor(
        row.kind,
        {
          url: row.url,
          storageId: row.storageId,
          originalUrl: row.originalUrl,
          originalStorageId: row.originalStorageId,
        },
        false
      )
    );
    await ctx.db.patch(row._id, { lastUsedAt: now });
    return row.url;
  },
});

/** The pictures to offer, newest first — at most five. */
export const listRecent = query({
  args: { kind: kindValidator, communityId: v.optional(v.id("communities")) },
  handler: async (ctx, { kind, communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = (await rowsFor(ctx, me._id, kind, communityId)).slice(0, RECENT_LIMIT);
    const profile = await loadTarget(ctx, me, communityId);
    const current = currentOf(profile, kind);
    return rows.map((row) => ({
      id: row._id,
      url: row.url,
      originalUrl: row.originalUrl ?? null,
      isCurrent: row.url === current?.url,
    }));
  },
});
