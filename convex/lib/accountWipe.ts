import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { forgetProfileImages, releaseWornImages } from "../profileImages";
import { dropUnusedLayerAssets } from "./cosmeticLayers";
import { releaseUrl } from "./files";

/**
 * Strip a user row down to an anonymous placeholder and delete every file its profile used.
 *
 * Shared by account deletion and by expired guest accounts. The row itself can't be deleted: messages
 * other people can still see, purchases we must keep for tax, and moderation records all point at
 * it. What goes is everything that made it a person.
 */
export async function wipeProfile(ctx: MutationCtx, user: Doc<"users">, identity: { name: string; username: string }): Promise<void> {
  await ctx.db.patch(user._id, {
    name: identity.name,
    username: identity.username,
    imageUrl: undefined,
    avatarStorageId: undefined,
    avatarAccent: undefined,
    avatarAccentUrl: undefined,
    avatarOriginalUrl: undefined,
    avatarOriginalStorageId: undefined,
    bannerUrl: undefined,
    bannerStorageId: undefined,
    bannerOriginalUrl: undefined,
    bannerOriginalStorageId: undefined,
    nameplateUrl: undefined,
    nameplateStorageId: undefined,
    dob: undefined,
    bio: undefined,
    borderGradientStart: undefined,
    borderGradientEnd: undefined,
    profileBg: undefined,
    customStatus: undefined,
    statusBubble: undefined,
    customStatusExpiresAt: undefined,
    customActivity: undefined,
    customActivityExpiresAt: undefined,
    themePackEntitlementId: undefined,
    avatarDecoration: undefined,
    avatarDecorationStorageId: undefined,
    avatarDecorationLayers: undefined,
    displayNameStyle: undefined,
    profileEffect: undefined,
    profileEffectStorageId: undefined,
    profileFrame: undefined,
    profileFrameStorageId: undefined,
    profileFrameMode: undefined,
    profileFrameFit: undefined,
    profileFrameAnchor: undefined,
    profileFrameScale: undefined,
    profileFrameOffsetY: undefined,
    profileFrameLayers: undefined,
    profileCss: undefined,
    birthdayDecoration: undefined,
    birthdayUntil: undefined,
    joinSoundId: undefined,
  });

  // Files second, once nothing on the row points at them any more.
  await releaseWornImages(ctx, user._id, user);
  await forgetProfileImages(ctx, user._id, "all");
  await releaseUrl(ctx, user.profileEffect, user.profileEffectStorageId);
  await releaseUrl(ctx, user.profileFrame, user.profileFrameStorageId);
  await releaseUrl(ctx, undefined, user.avatarDecorationStorageId);
  await dropUnusedLayerAssets(ctx, user.avatarDecorationLayers, []);
  await dropUnusedLayerAssets(ctx, user.profileFrameLayers, []);
}
