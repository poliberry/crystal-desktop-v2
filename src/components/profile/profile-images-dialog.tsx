"use client";

import { CosmeticMedia } from "@/components/motion/cosmetic-media";
import { useQuery } from "convex/react";
import { Check, ImagePlus, Loader2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  AVATAR_CROP,
  BANNER_CROP,
  ImageCropDialog,
  NAMEPLATE_CROP,
  type CropShape,
} from "@/components/profile/image-crop-dialog";
import { isVideoNameplate, Nameplate, NAMEPLATE_ACCEPT } from "@/components/profile/nameplate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DIALOG_MORPH_FRAME, DialogMorph } from "@/components/ui/dialog-morph";
import type { ProfileScope } from "@/hooks/use-profile-scope";
import { MAX_PROFILE_ASSET_BYTES, MAX_PROFILE_ASSET_LABEL } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

/** The three pictures behind a profile, and the order they are offered in. */
export type ProfileImageKind = "avatar" | "banner" | "nameplate";

const KINDS: {
  kind: ProfileImageKind;
  label: string;
  hint: string;
  crop: CropShape;
  /** Width ÷ height of a tile showing one of these. */
  aspect: number;
  accept: string;
}[] = [
  {
    kind: "avatar",
    label: "Avatar",
    hint: "Your picture, everywhere you appear.",
    crop: AVATAR_CROP,
    aspect: 1,
    accept: "image/*",
  },
  {
    kind: "banner",
    label: "Banner",
    hint: "The picture across the top of your profile card.",
    crop: BANNER_CROP,
    aspect: BANNER_CROP.aspect,
    accept: "image/*",
  },
  {
    kind: "nameplate",
    label: "Nameplate",
    hint: "The strip behind your name in chat. A picture, or a short video.",
    crop: NAMEPLATE_CROP,
    aspect: NAMEPLATE_CROP.aspect,
    accept: NAMEPLATE_ACCEPT,
  },
];

/** A recent picture, as `profileImages.listRecent` hands it over. */
interface RecentImage {
  id: Id<"profileImages">;
  url: string;
  originalUrl: string | null;
  isCurrent: boolean;
}

/**
 * Avatar, banner and nameplate in one dialog.
 *
 * Each has the same two ways in: pick one of the last five pictures worn (one
 * click — they are all still there), or upload a new one, which opens the
 * crop view *inside this dialog* to set its size, crop and position before it
 * is kept. The crop is a second view of the same dialog rather than a second
 * dialog stacked over it, for the reason spelled out on `DialogMorph`.
 *
 * Videos are the exception: a nameplate can be a short clip, and a clip can't be
 * cropped here, so it goes straight up.
 */
export function ProfileImagesDialog({
  open,
  onOpenChange,
  scope,
  scopeId,
  initialKind = "avatar",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProfileScope;
  /** Which profile — the account's, or the caller's identity in a server. */
  scopeId?: Id<"communities">;
  initialKind?: ProfileImageKind;
}) {
  const [kind, setKind] = useState<ProfileImageKind>(initialKind);
  const [cropping, setCropping] = useState<{ source: File | string } | null>(null);
  const [busy, setBusy] = useState<null | "upload" | Id<"profileImages"> | "remove">(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Opens on the tab it was opened for, and back at the browse view: the dialog
  // stays mounted between openings, so what was left over would otherwise show.
  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setCropping(null);
    setError(null);
    setBusy(null);
  }, [open, initialKind]);

  const recent = useQuery(
    api.profileImages.listRecent,
    open ? { kind, communityId: scopeId } : "skip",
  ) as RecentImage[] | undefined;

  const values = scope.values;
  const spec = KINDS.find((entry) => entry.kind === kind)!;
  const current =
    kind === "avatar"
      ? values?.imageUrl
      : kind === "banner"
        ? values?.bannerUrl
        : values?.nameplateUrl;
  const currentOriginal =
    kind === "avatar"
      ? values?.avatarOriginalUrl
      : kind === "banner"
        ? values?.bannerOriginalUrl
        : undefined;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_PROFILE_ASSET_BYTES) {
      setError(`That file must be smaller than ${MAX_PROFILE_ASSET_LABEL}.`);
      return;
    }
    // A clip can't be framed, so it is sent as it is.
    if (kind === "nameplate" && file.type.startsWith("video/")) {
      setBusy("upload");
      try {
        await scope.setNameplate(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That upload didn't work.");
      } finally {
        setBusy(null);
      }
      return;
    }
    setCropping({ source: file });
  };

  const saveCrop = async (crop: Blob) => {
    const source = cropping?.source;
    if (!source) return;
    const original = source instanceof File ? source : undefined;
    if (kind === "avatar") await scope.setAvatar(crop, original);
    else if (kind === "banner") await scope.setBanner(crop, original);
    else {
      await scope.setNameplate(
        new File([crop], "nameplate.webp", { type: crop.type || "image/webp" }),
      );
    }
  };

  const apply = async (image: RecentImage) => {
    if (image.isCurrent || busy) return;
    setBusy(image.id);
    setError(null);
    try {
      await scope.applyRecentImage(image.id, kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that one.");
    } finally {
      setBusy(null);
    }
  };

  const removeCurrent = async () => {
    setBusy("remove");
    setError(null);
    try {
      if (kind === "banner") await scope.removeBanner();
      else await scope.removeNameplate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(DIALOG_MORPH_FRAME, cropping ? "sm:max-w-md" : "sm:max-w-2xl")}
      >
        <DialogMorph view={cropping ? "crop" : "browse"} direction={cropping ? 1 : -1} className="grid gap-4">
          {cropping ? (
            <ImageCropDialog
              inline
              open
              onOpenChange={(next) => !next && setCropping(null)}
              source={cropping.source}
              shape={spec.crop}
              title={`Position your ${spec.label.toLowerCase()}`}
              onCropped={saveCrop}
            />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Profile images</DialogTitle>
                <DialogDescription>
                  For {scope.label}. Pick one you have used lately, or upload a new one and
                  set its size, crop and position.
                </DialogDescription>
              </DialogHeader>

              {/* Which picture. */}
              <div role="tablist" className="grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1">
                {KINDS.map((entry) => (
                  <button
                    key={entry.kind}
                    type="button"
                    role="tab"
                    aria-selected={entry.kind === kind}
                    onClick={() => {
                      setKind(entry.kind);
                      setError(null);
                    }}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      entry.kind === kind
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium">Now</p>
                <CurrentPreview kind={kind} url={current} name={values?.name ?? ""} />
                <p className="text-xs text-muted-foreground">{spec.hint}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium">Recently used</p>
                <RecentGrid
                  kind={kind}
                  aspect={spec.aspect}
                  images={recent}
                  busy={busy}
                  onPick={(image) => void apply(image)}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <input
                ref={fileRef}
                type="file"
                accept={spec.accept}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void pick(file);
                }}
              />

              <DialogFooter className="items-center sm:justify-between">
                <div className="flex gap-1">
                  {currentOriginal && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCropping({ source: currentOriginal })}
                    >
                      <Pencil className="size-4" />
                      Adjust crop
                    </Button>
                  )}
                  {kind !== "avatar" && current && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={busy === "remove"}
                      onClick={() => void removeCurrent()}
                    >
                      {busy === "remove" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Remove
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Done
                  </Button>
                  <Button
                    type="button"
                    disabled={busy === "upload"}
                    onClick={() => fileRef.current?.click()}
                  >
                    {busy === "upload" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImagePlus className="size-4" />
                    )}
                    Upload new
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogMorph>
      </DialogContent>
    </Dialog>
  );
}

/** What is being worn now, drawn the way it appears — a nameplate behind a name,
 * an avatar as a square — rather than as a bare picture. */
function CurrentPreview({
  kind,
  url,
  name,
}: {
  kind: ProfileImageKind;
  url: string | undefined;
  name: string;
}) {
  if (kind === "avatar") {
    return (
      <div className="flex items-center gap-3">
        <div className="size-24 overflow-hidden rounded-2xl border bg-muted/40">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-2xl text-muted-foreground">
              {name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (kind === "banner") {
    return (
      <div className="relative h-28 overflow-hidden rounded-xl border bg-muted/40">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <p className="flex size-full items-center justify-center text-sm text-muted-foreground">
            No banner
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="relative flex h-14 items-center overflow-hidden rounded-xl border bg-muted/40 px-4">
      {url ? (
        <Nameplate url={url} className="opacity-100 [mask-image:none]" />
      ) : (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No nameplate
        </p>
      )}
      <span className="relative text-sm font-semibold drop-shadow">{name || "Your name"}</span>
    </div>
  );
}

/** The last five pictures, as tiles — the one being worn marked, the rest one
 * click away. Blank slots are drawn too, so the row is the same shape whether
 * there are five or one. */
function RecentGrid({
  kind,
  aspect,
  images,
  busy,
  onPick,
}: {
  kind: ProfileImageKind;
  aspect: number;
  images: RecentImage[] | undefined;
  busy: unknown;
  onPick: (image: RecentImage) => void;
}) {
  // Square pictures sit five across; the wide ones need more room each.
  const columns = kind === "avatar" ? "grid-cols-5" : kind === "banner" ? "grid-cols-3" : "grid-cols-2";
  const slots = kind === "avatar" ? 5 : kind === "banner" ? 3 : 2;

  if (images === undefined) {
    return (
      <div className={cn("grid gap-2", columns)}>
        {Array.from({ length: slots }, (_, index) => (
          <div
            key={index}
            style={{ aspectRatio: aspect }}
            className="animate-pulse rounded-lg bg-muted/40"
          />
        ))}
      </div>
    );
  }
  if (images.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
        Nothing yet — pictures you use will be kept here.
      </p>
    );
  }
  return (
    <div className={cn("grid gap-2", columns)}>
      {images.map((image) => (
        <button
          key={image.id}
          type="button"
          title={image.isCurrent ? "In use" : "Use this one"}
          aria-pressed={image.isCurrent}
          onClick={() => onPick(image)}
          style={{ aspectRatio: aspect }}
          className={cn(
            "group relative overflow-hidden rounded-lg border bg-muted/40 transition-all",
            image.isCurrent
              ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
              : "hover:border-primary/60 hover:shadow-md",
          )}
        >
          {kind === "nameplate" && isVideoNameplate(image.url) ? (
            <video src={image.url} muted loop playsInline className="size-full object-cover" />
          ) : (
            <CosmeticMedia src={image.url} />
          )}
          {image.isCurrent && (
            <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" />
            </span>
          )}
          {busy === image.id && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="size-4 animate-spin" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
