"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getAvatarColor } from "@/lib/avatar-color";
import { uploadToStorage } from "@/lib/storage-upload";
import { useConvex } from "convex/react";
import type {
  ProfileFrameLayout,
  ProfileFrameMode,
} from "@/lib/profile-cosmetics";
import type { CosmeticLayer } from "@/lib/cosmetic-layers";

/** The layer shape the mutations take: the same thing, with Convex's branded
 * storage id where the client carries a string. */
type StoredLayers = (Omit<CosmeticLayer, "storageId"> & {
  storageId?: Id<"_storage">;
})[];

/**
 * One profile being edited — the account's, or the caller's identity in one
 * community — behind a single set of actions.
 *
 * The profile editor lets you pick a scope from a dropdown and then edit the
 * same list of things either way, so without this every section of the rail
 * would carry an `if (communityId)` and two mutation calls that must be kept
 * in step. The branch happens once, here.
 *
 * Every mutation for both scopes is subscribed unconditionally, because hooks
 * cannot be called behind a condition; which one runs is decided when an
 * action is actually invoked. That costs nothing — `useMutation` only builds a
 * callable.
 */

export interface ProfileScopeValues {
  name: string;
  bio: string;
  customStatus: string;
  imageUrl?: string;
  avatarOriginalUrl?: string;
  bannerUrl?: string;
  bannerOriginalUrl?: string;
  nameplateUrl?: string;
  borderGradientStart?: string;
  borderGradientEnd?: string;
  displayNameStyle?: string;
  profileEffect?: string;
  profileFrame?: string;
  profileFrameMode?: string;
  profileFrameFit?: string;
  profileFrameAnchor?: string;
  profileFrameScale?: number;
  profileFrameOffsetY?: number;
  /** The frame as placed artwork, which is what the canvas editor reads back —
   * without it the editor opens empty on a frame that is plainly there. */
  profileFrameLayers?: CosmeticLayer[];
  /** The owner's own stylesheet for this card. */
  profileCss?: string;
  /** Account-level and not overridable per server — a decoration is worn by
   * the person. Carried here so the rail can still show it in a server scope,
   * where it's read-only. */
  avatarDecoration?: string;
}

export interface ProfileScope {
  /** Null while the underlying queries are still in flight. */
  values: ProfileScopeValues | null;
  isAccount: boolean;
  /** For copy: "your main profile" / "your Arch profile". */
  label: string;
  /** A file as picked (an image, or a short video), or an image already cropped. */
  setNameplate: (file: Blob) => Promise<void>;
  removeNameplate: () => Promise<void>;
  /** Takes an already-cropped blob plus, for a fresh pick, the untouched
   * original — the pairing the crop editor produces. */
  setAvatar: (crop: Blob, original?: Blob) => Promise<void>;
  setBanner: (crop: Blob, original?: Blob) => Promise<void>;
  removeBanner: () => Promise<void>;
  /** Wear one of the pictures from the recent list again — see
   * convex/profileImages.ts. */
  applyRecentImage: (id: Id<"profileImages">, kind: "avatar" | "banner" | "nameplate") => Promise<void>;
  setGradient: (start: string, end: string) => Promise<void>;
  setDisplayNameStyle: (style: string) => Promise<void>;
  setEffect: (file: File) => Promise<void>;
  removeEffect: () => Promise<void>;
  setFrame: (file: File, mode: ProfileFrameMode) => Promise<void>;
  setFrameMode: (mode: ProfileFrameMode) => Promise<void>;
  /** Where the frame sits — see `ProfileFrameLayout`. Partial, so a slider
   * can send only what it changed. */
  setFrameLayout: (layout: Partial<ProfileFrameLayout>) => Promise<void>;
  /** The frame as placed artwork — the whole arrangement at once, which is
   * what the canvas editor produces. */
  setFrameLayers: (layers: CosmeticLayer[]) => Promise<void>;
  /** The avatar decoration, likewise. Account-level in both scopes: a
   * decoration is worn by the person, not by one server identity. */
  setDecorationLayers: (layers: CosmeticLayer[]) => Promise<void>;
  /** Puts a picked file in storage and hands back its URL, for a layer to
   * point at. */
  uploadLayerImage: (
    file: File,
    kind?: "decoration" | "sticker",
  ) => Promise<{ url: string; storageId?: string }>;
  removeFrame: () => Promise<void>;
  /** The card's own stylesheet, confined to the card when it's rendered. */
  setCss: (css: string) => Promise<void>;
  /** Name, bio and status together — the three that live behind a Save button
   * rather than applying on click like the cosmetics do. */
  saveText: (text: { name: string; bio: string; customStatus: string }) => Promise<void>;
}

export function useProfileScope(
  communityId: Id<"communities"> | undefined,
  communityName?: string
): ProfileScope {
  const isAccount = !communityId;
  const me = useQuery(api.users.getCurrentUser);
  const serverProfile = useQuery(
    api.serverProfiles.getMyServerProfile,
    communityId ? { communityId } : "skip"
  );

  // --- Account mutations ---
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const setImageM = useMutation(api.profileImages.set);
  const removeImageM = useMutation(api.profileImages.remove);
  const applyRecentM = useMutation(api.profileImages.applyRecent);
  const setAvatarAccent = useMutation(api.users.setAvatarAccent);
  const updateProfile = useMutation(api.users.updateProfile);
  const updateProfileExtended = useMutation(api.users.updateProfileExtended);
  const setDisplayNameStyleM = useMutation(api.users.setDisplayNameStyle);
  const setProfileEffectM = useMutation(api.users.setProfileEffect);
  const removeProfileEffectM = useMutation(api.users.removeProfileEffect);
  const setProfileFrameM = useMutation(api.users.setProfileFrame);
  const setProfileFrameModeM = useMutation(api.users.setProfileFrameMode);
  const removeProfileFrameM = useMutation(api.users.removeProfileFrame);
  const setProfileFrameLayoutM = useMutation(api.users.setProfileFrameLayout);
  const setProfileFrameLayersM = useMutation(api.users.setProfileFrameLayers);
  const setAvatarDecorationLayersM = useMutation(api.users.setAvatarDecorationLayers);
  const uploadCosmeticLayerM = useMutation(api.users.uploadCosmeticLayer);
  const setProfileCssM = useMutation(api.users.setProfileCss);

  // --- Server-profile mutations ---
  const setServerAvatarAccent = useMutation(api.serverProfiles.setServerAvatarAccent);
  const setServerGradient = useMutation(api.serverProfiles.setServerGradient);
  const upsertServerProfile = useMutation(api.serverProfiles.upsertServerProfile);
  const setServerDisplayNameStyle = useMutation(
    api.serverProfiles.setServerDisplayNameStyle
  );
  const setServerProfileEffect = useMutation(api.serverProfiles.setServerProfileEffect);
  const removeServerProfileEffect = useMutation(
    api.serverProfiles.removeServerProfileEffect
  );
  const setServerProfileFrame = useMutation(api.serverProfiles.setServerProfileFrame);
  const setServerProfileFrameMode = useMutation(
    api.serverProfiles.setServerProfileFrameMode
  );
  const removeServerProfileFrame = useMutation(
    api.serverProfiles.removeServerProfileFrame
  );
  const setServerProfileFrameLayout = useMutation(
    api.serverProfiles.setServerProfileFrameLayout
  );
  const setServerProfileFrameLayers = useMutation(
    api.serverProfiles.setServerProfileFrameLayers
  );
  const setServerProfileCss = useMutation(api.serverProfiles.setServerProfileCss);

  /**
   * What the editor shows.
   *
   * In a server scope this is the *merged* view — the server's value where
   * there is one, the account's underneath — because that is what the card
   * actually renders there. Editing a field then writes only to the server
   * profile, which is what makes "leave it alone and it follows the account"
   * the default without a tri-state control anywhere in the UI.
   */
  const values = useMemo<ProfileScopeValues | null>(() => {
    if (!me) return null;
    if (isAccount) {
      return {
        name: me.name,
        bio: me.bio ?? "",
        customStatus: me.customStatus ?? "",
        imageUrl: me.imageUrl,
        avatarOriginalUrl: me.avatarOriginalUrl,
        bannerUrl: me.bannerUrl,
        bannerOriginalUrl: me.bannerOriginalUrl,
        nameplateUrl: me.nameplateUrl,
        borderGradientStart: me.borderGradientStart,
        borderGradientEnd: me.borderGradientEnd,
        displayNameStyle: me.displayNameStyle,
        profileEffect: me.profileEffect,
        profileFrame: me.profileFrame,
        profileFrameMode: me.profileFrameMode,
        profileFrameFit: me.profileFrameFit,
        profileFrameAnchor: me.profileFrameAnchor,
        profileFrameScale: me.profileFrameScale,
        profileFrameOffsetY: me.profileFrameOffsetY,
        profileFrameLayers: me.profileFrameLayers,
        profileCss: me.profileCss,
        avatarDecoration: me.avatarDecoration,
      };
    }
    // `undefined` rather than null while the server profile is loading, so the
    // rail doesn't paint the account's values and then swap them out.
    if (serverProfile === undefined) return null;
    const sp = serverProfile;
    return {
      name: sp?.displayName ?? me.name,
      bio: sp?.bio ?? me.bio ?? "",
      customStatus: sp?.customStatus ?? me.customStatus ?? "",
      imageUrl: sp?.imageUrl ?? me.imageUrl,
      avatarOriginalUrl: sp?.avatarOriginalUrl,
      bannerUrl: sp?.bannerUrl ?? me.bannerUrl,
      bannerOriginalUrl: sp?.bannerOriginalUrl,
      nameplateUrl: sp?.nameplateUrl ?? me.nameplateUrl,
      borderGradientStart: sp?.borderGradientStart ?? me.borderGradientStart,
      borderGradientEnd: sp?.borderGradientEnd ?? me.borderGradientEnd,
      displayNameStyle: sp?.displayNameStyle ?? me.displayNameStyle,
      profileEffect: sp?.profileEffect ?? me.profileEffect,
      profileFrame: sp?.profileFrame ?? me.profileFrame,
      profileFrameMode: sp?.profileFrame ? sp.profileFrameMode : me.profileFrameMode,
      // Placement travels with whichever profile supplied the frame.
      profileFrameFit: sp?.profileFrame ? sp.profileFrameFit : me.profileFrameFit,
      profileFrameAnchor: sp?.profileFrame
        ? sp.profileFrameAnchor
        : me.profileFrameAnchor,
      profileFrameScale: sp?.profileFrame
        ? sp.profileFrameScale
        : me.profileFrameScale,
      profileFrameOffsetY: sp?.profileFrame
        ? sp.profileFrameOffsetY
        : me.profileFrameOffsetY,
      // As a set from whichever profile has any, for the reason the card reads
      // them that way: two arrangements merged layer by layer are neither.
      profileFrameLayers: sp?.profileFrameLayers?.length
        ? sp.profileFrameLayers
        : me.profileFrameLayers,
      profileCss: sp?.profileCss ?? me.profileCss,
      avatarDecoration: me.avatarDecoration,
    };
  }, [me, serverProfile, isAccount]);

  const convex = useConvex();
  /**
   * Upload a picture, to Cloudflare R2 when it is configured and to Convex
   * storage when it isn't.
   *
   * Every image the app stores goes through the CDN first — see
   * convex/cdn.ts — so what is written to a profile is the CDN's own URL and
   * viewers are served from Cloudflare's edge. Convex storage is only the
   * fallback for a deployment with no bucket, and the one place that decides
   * between the two is `uploadViaR2OrConvex`.
   */
  const put = useCallback(
    async (
      data: Blob,
      kind: "avatars" | "banners" | "nameplates" | "backgrounds",
    ): Promise<{ storageId?: Id<"_storage">; cdnKey?: string; cdnUrl?: string }> => {
      const file = data instanceof File ? data : new File([data], "upload", { type: data.type });
      const { uploadViaR2OrConvex } = await import("@/lib/r2-client");
      return (await uploadViaR2OrConvex(convex as never, file, kind, generateUploadUrl)) as {
        storageId?: Id<"_storage">;
        cdnKey?: string;
        cdnUrl?: string;
      };
    },
    [convex, generateUploadUrl],
  );

  const cid = communityId as Id<"communities">;

  return useMemo<ProfileScope>(
    () => ({
      values,
      isAccount,
      label: isAccount ? "your main profile" : `your ${communityName ?? "server"} profile`,

      setAvatar: async (crop, original) => {
        const res = await put(crop, "avatars");
        const orig = original ? await put(original, "avatars") : undefined;
        const url = await setImageM({
          kind: "avatar",
          communityId,
          storageId: res.storageId,
          cdnKey: res.cdnKey,
          cdnUrl: res.cdnUrl,
          originalStorageId: orig?.storageId,
          originalCdnKey: orig?.cdnKey,
          originalCdnUrl: orig?.cdnUrl,
        });
        // The tint cached for the old picture is cleared by the write; sample
        // the new one so cards that colour themselves from it have it at once.
        const accent = await getAvatarColor(url);
        if (accent) {
          if (isAccount) await setAvatarAccent({ accent, sourceUrl: url });
          else await setServerAvatarAccent({ communityId: cid, accent, sourceUrl: url });
        }
      },

      setBanner: async (crop, original) => {
        const res = await put(crop, "banners");
        const orig = original ? await put(original, "banners") : undefined;
        await setImageM({
          kind: "banner",
          communityId,
          storageId: res.storageId,
          cdnKey: res.cdnKey,
          cdnUrl: res.cdnUrl,
          originalStorageId: orig?.storageId,
          originalCdnKey: orig?.cdnKey,
          originalCdnUrl: orig?.cdnUrl,
        });
      },
      removeBanner: async () => {
        await removeImageM({ kind: "banner", communityId });
      },

      setNameplate: async (file) => {
        const res = await put(file, "nameplates");
        await setImageM({
          kind: "nameplate",
          communityId,
          storageId: res.storageId,
          cdnKey: res.cdnKey,
          cdnUrl: res.cdnUrl,
        });
      },
      removeNameplate: async () => {
        await removeImageM({ kind: "nameplate", communityId });
      },

      applyRecentImage: async (id, kind) => {
        const url = await applyRecentM({ id });
        if (kind !== "avatar") return;
        const accent = await getAvatarColor(url);
        if (!accent) return;
        if (isAccount) await setAvatarAccent({ accent, sourceUrl: url });
        else await setServerAvatarAccent({ communityId: cid, accent, sourceUrl: url });
      },

      setGradient: async (start, end) => {
        if (isAccount) {
          await updateProfileExtended({
            borderGradientStart: start || undefined,
            borderGradientEnd: end || undefined,
          });
        } else {
          await setServerGradient({
            communityId: cid,
            borderGradientStart: start || undefined,
            borderGradientEnd: end || undefined,
          });
        }
      },

      setDisplayNameStyle: async (style) => {
        if (isAccount) await setDisplayNameStyleM({ style });
        else await setServerDisplayNameStyle({ communityId: cid, style });
      },

      setEffect: async (file) => {
        const res = await put(file, "backgrounds");
        if (isAccount) await setProfileEffectM({ storageId: res.storageId, cdnKey: res.cdnKey, cdnUrl: res.cdnUrl } as never);
        else await setServerProfileEffect({ communityId: cid, storageId: res.storageId, cdnKey: res.cdnKey, cdnUrl: res.cdnUrl } as never);
      },
      removeEffect: async () => {
        if (isAccount) await removeProfileEffectM();
        else await removeServerProfileEffect({ communityId: cid });
      },

      setFrame: async (file, mode) => {
        const res = await put(file, "backgrounds");
        if (isAccount) await setProfileFrameM({ storageId: res.storageId, cdnKey: res.cdnKey, cdnUrl: res.cdnUrl, mode } as never);
        else await setServerProfileFrame({ communityId: cid, storageId: res.storageId, cdnKey: res.cdnKey, cdnUrl: res.cdnUrl, mode } as never);
      },
      setFrameMode: async (mode) => {
        if (isAccount) await setProfileFrameModeM({ mode });
        else await setServerProfileFrameMode({ communityId: cid, mode });
      },
      setFrameLayout: async (layout) => {
        if (isAccount) await setProfileFrameLayoutM(layout);
        else await setServerProfileFrameLayout({ communityId: cid, ...layout });
      },
      setFrameLayers: async (layers) => {
        // The cast is the schema's branded storage id meeting a plain string:
        // a layer travels through the editor and the renderer as data, and
        // neither has any business importing the data model to hold an id it
        // only ever passes back.
        const args = { layers: layers as StoredLayers };
        if (isAccount) await setProfileFrameLayersM(args);
        else await setServerProfileFrameLayers({ communityId: cid, ...args });
      },
      setDecorationLayers: async (layers) => {
        await setAvatarDecorationLayersM({ layers: layers as StoredLayers });
      },
      uploadLayerImage: async (file, kind = "sticker") => {
        // CDN first, like every other picture: a layer's `url` is then the
        // CDN's own address, with no storage id to carry. Convex storage is the
        // fallback for a deployment with no bucket.
        const { tryUploadViaR2 } = await import("@/lib/r2-client");
        const r2 = await tryUploadViaR2(
          convex as never,
          file,
          kind === "decoration" ? "avatar-decorations" : "avatar-frames",
        );
        if (r2) return { url: r2.cdnUrl };
        const storageId = (await uploadToStorage(
          await generateUploadUrl(),
          file,
        )) as Id<"_storage">;
        const url = await uploadCosmeticLayerM({ storageId });
        return { url, storageId };
      },
      removeFrame: async () => {
        if (isAccount) await removeProfileFrameM();
        else await removeServerProfileFrame({ communityId: cid });
      },

      setCss: async (css) => {
        if (isAccount) await setProfileCssM({ css });
        else await setServerProfileCss({ communityId: cid, css });
      },

      saveText: async ({ name, bio, customStatus }) => {
        if (isAccount) {
          // Username isn't editable from here — it has its own uniqueness
          // check and lives in Account settings, so the current one is passed
          // through untouched.
          await updateProfile({ name, username: me?.username ?? "", bio });
          await updateProfileExtended({ customStatus: customStatus.trim() });
          return;
        }
        await upsertServerProfile({
          communityId: cid,
          displayName: name,
          bio,
          customStatus,
        });
      },
    }),
    [
      values,
      isAccount,
      communityName,
      cid,
      convex,
      generateUploadUrl,
      uploadCosmeticLayerM,
      me?.username,
      put,
      setImageM,
      removeImageM,
      applyRecentM,
      setAvatarAccent,
      setServerAvatarAccent,
      communityId,
      updateProfileExtended,
      setServerGradient,
      setDisplayNameStyleM,
      setServerDisplayNameStyle,
      setProfileEffectM,
      removeProfileEffectM,
      setServerProfileEffect,
      removeServerProfileEffect,
      setProfileFrameM,
      setProfileFrameModeM,
      removeProfileFrameM,
      setProfileFrameLayoutM,
      setProfileCssM,
      setServerProfileFrameLayout,
      setServerProfileCss,
      setServerProfileFrame,
      setServerProfileFrameMode,
      removeServerProfileFrame,
      updateProfile,
      upsertServerProfile,
    ]
  );
}
