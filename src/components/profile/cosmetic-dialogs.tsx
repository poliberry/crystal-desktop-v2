"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Upload } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GradientPicker } from "@/components/profile/gradient-picker";
import { ProfileFrameLayer } from "@/components/profile/profile-card-cosmetics";
import { Nameplate, NAMEPLATE_ACCEPT } from "@/components/profile/nameplate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { DECORATION_PRESETS, isCustomDecoration } from "@/lib/avatar-decorations";
import {
  DEFAULT_FRAME_LAYOUT,
  DISPLAY_NAME_STYLES,
  FRAME_ANCHORS,
  FRAME_FITS,
  FRAME_OFFSET_RANGE,
  FRAME_SCALE_RANGE,
  frameHeadroom,
  frameLayout,
  type ProfileFrameLayout,
} from "@/lib/profile-cosmetics";
import { uploadToStorage } from "@/lib/storage-upload";
import {
  MAX_DECORATION_BYTES,
  MAX_DECORATION_LABEL,
  MAX_PROFILE_ASSET_BYTES,
  MAX_PROFILE_ASSET_LABEL,
} from "@/lib/upload-limits";
import { cn } from "@/lib/utils";
import type { ProfileScope } from "@/hooks/use-profile-scope";

/**
 * The editors behind each tile in the profile editor's left rail.
 *
 * Every one of them is a dialog rather than an inline panel, because the rail
 * is 260 pixels wide and these all need a preview to be worth using — a
 * decoration is meaningless without the avatar inside it, and a frame is
 * meaningless without a card to wrap. The rail shows the current state; this
 * is where it's chosen.
 */

/** A dialog shell, so the five below differ only in their contents. */
function CosmeticDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pick a file, size-check it, hand it over. The check is a courtesy that
 * saves a doomed transfer — the mutation enforces it once the bytes land. */
function UploadButton({
  label,
  maxBytes,
  maxLabel,
  accept = "image/png,image/gif,image/webp,image/jpeg",
  onPick,
}: {
  label: string;
  maxBytes: number;
  maxLabel: string;
  accept?: string;
  onPick: (file: File) => Promise<void>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => ref.current?.click()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > maxBytes) {
            setError(`That file must be smaller than ${maxLabel}.`);
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await onPick(file);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Avatar decorations.
 *
 * Account-scoped even when a server profile is being edited — a decoration is
 * worn by the person, not by one of their identities, which is why
 * `users.getProfile` returns it unmerged. The dialog says so rather than
 * silently writing to the wrong place.
 */
export function DecorationDialog({
  open,
  onOpenChange,
  imageUrl,
  name,
  current,
  isAccount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl?: string;
  name: string;
  current?: string;
  isAccount: boolean;
}) {
  const setAvatarDecoration = useMutation(api.users.setAvatarDecoration);
  const setCustomAvatarDecoration = useMutation(api.users.setCustomAvatarDecoration);
  const removeAvatarDecoration = useMutation(api.users.removeAvatarDecoration);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);

  const swatch = (
    label: string,
    src: string | undefined,
    selected: boolean,
    onSelect: () => void,
  ) => (
    <button
      key={label}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-20 flex-col items-center gap-1 rounded-md border p-2 transition-colors",
        selected ? "border-primary bg-accent/60" : "border-transparent hover:bg-accent/40",
      )}
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="size-full rounded-md object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            {name.slice(0, 2).toUpperCase()}
          </span>
        )}
        {src && (
          // The geometry `AvatarDecoration` uses, repeated because this is a
          // standalone preview rather than an `Avatar`.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="pointer-events-none absolute top-1/2 left-1/2 h-[126%] w-[126%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
          />
        )}
      </span>
      <span className="w-full truncate text-center text-[11px] text-muted-foreground">
        {label}
      </span>
    </button>
  );

  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Avatar decoration"
      description={
        isAccount
          ? "A frame drawn around your avatar wherever you appear."
          : "Decorations are worn by you rather than by one server identity, so this applies everywhere."
      }
      footer={
        <>
          <UploadButton
            label="Upload your own"
            maxBytes={MAX_DECORATION_BYTES}
            maxLabel={MAX_DECORATION_LABEL}
            accept="image/png,image/gif,image/webp,image/svg+xml"
            onPick={async (file) => {
              const storageId = (await uploadToStorage(
                await generateUploadUrl(),
                file,
              )) as Id<"_storage">;
              await setCustomAvatarDecoration({ storageId });
            }}
          />
          {current && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => void removeAvatarDecoration()}
            >
              Remove
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-start gap-2">
        {swatch("None", undefined, !current, () =>
          void setAvatarDecoration({ value: "" }),
        )}
        {DECORATION_PRESETS.map((preset) =>
          swatch(preset.name, preset.src, current === preset.value, () =>
            void setAvatarDecoration({ value: preset.value }),
          ),
        )}
        {isCustomDecoration(current) &&
          swatch("Yours", current, true, () => {})}
      </div>
      <p className="text-xs text-muted-foreground">
        A square, transparent PNG or GIF works best — it isn&apos;t cropped, it&apos;s
        drawn over and around your avatar. Up to {MAX_DECORATION_LABEL}.
      </p>
    </CosmeticDialog>
  );
}

/* -------------------------------------------------------------------------- */

export function DisplayNameStyleDialog({
  open,
  onOpenChange,
  name,
  current,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  current?: string;
  scope: ProfileScope;
}) {
  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Display name style"
      description="How your name is drawn on your profile card."
    >
      <div className="grid grid-cols-2 gap-2">
        {DISPLAY_NAME_STYLES.map((style) => {
          const selected = (current ?? "default") === style.key;
          return (
            <button
              key={style.key}
              type="button"
              aria-pressed={selected}
              onClick={() => void scope.setDisplayNameStyle(style.key)}
              className={cn(
                "rounded-md border p-3 text-left transition-colors",
                selected ? "border-primary bg-accent/60" : "border-border hover:bg-accent/40",
              )}
            >
              {/* Shown at the size and weight the card uses, because these
                  styles are mostly about weight and colour and read very
                  differently at label size. */}
              <p className={cn("truncate text-xl font-bold leading-tight", style.className)}>
                {name || "Your name"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{style.label}</p>
            </button>
          );
        })}
      </div>
    </CosmeticDialog>
  );
}

/* -------------------------------------------------------------------------- */

export function ThemeDialog({
  open,
  onOpenChange,
  scope,
  onPickBanner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProfileScope;
  /** Opens the crop editor, which the rail owns — a crop dialog inside a
   * dialog inside a dialog is one layer more than this needs. */
  onPickBanner: () => void;
}) {
  const values = scope.values;
  // Local, because the two colour inputs are dragged continuously and writing
  // on every frame would be a mutation per pixel. Committed on close and by
  // the Apply button.
  const [start, setStart] = useState(values?.borderGradientStart ?? "");
  const [end, setEnd] = useState(values?.borderGradientEnd ?? "");

  const apply = () => void scope.setGradient(start, end);

  return (
    <CosmeticDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) apply();
        onOpenChange(next);
      }}
      title="Theme & banner"
      description="The picture across the top of your card, and the gradient framing it."
      footer={
        <>
          <Button variant="outline" onClick={onPickBanner}>
            {values?.bannerUrl ? "Replace banner" : "Upload banner"}
          </Button>
          {values?.bannerUrl && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => void scope.removeBanner()}
            >
              Remove banner
            </Button>
          )}
          <Button onClick={() => { apply(); onOpenChange(false); }}>Done</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Banner</Label>
          <div
            className={cn(
              "h-24 rounded-md bg-cover bg-center",
              !values?.bannerUrl &&
                "flex items-center justify-center border-2 border-dashed bg-muted/40",
            )}
            style={
              values?.bannerUrl
                ? { backgroundImage: `url(${values.bannerUrl})` }
                : undefined
            }
          >
            {!values?.bannerUrl && (
              <span className="text-xs text-muted-foreground">No banner yet</span>
            )}
          </div>
        </div>

        <GradientPicker
          start={start}
          end={end}
          onStartChange={setStart}
          onEndChange={setEnd}
          bannerUrl={values?.bannerUrl}
        />
      </div>
    </CosmeticDialog>
  );
}

/* -------------------------------------------------------------------------- */

export function ProfileEffectDialog({
  open,
  onOpenChange,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProfileScope;
}) {
  const current = scope.values?.profileEffect;
  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Profile effect"
      description="Artwork played over the whole of your profile card, wherever it's shown. It plays once, then again every twenty seconds."
      footer={
        <>
          <UploadButton
            label={current ? "Replace" : "Upload an effect"}
            maxBytes={MAX_PROFILE_ASSET_BYTES}
            maxLabel={MAX_PROFILE_ASSET_LABEL}
            onPick={(file) => scope.setEffect(file)}
          />
          {current && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => void scope.removeEffect()}
            >
              Remove
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-[repeating-conic-gradient(#0000_0_25%,#ffffff12_0_50%)] bg-[length:16px_16px]">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="" className="h-full w-full object-cover" />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing uploaded yet</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          A transparent PNG, GIF or WebP roughly the shape of a profile card. It
          covers the card edge to edge and never swallows a click, so it can pass
          over the buttons safely. Up to {MAX_PROFILE_ASSET_LABEL}.
        </p>
      </div>
    </CosmeticDialog>
  );
}

/* -------------------------------------------------------------------------- */


/**
 * A card, at a size that fits in a dialog, for positioning a frame against.
 *
 * A stand-in rather than the real `MemberProfileCard`: the real one is 360
 * pixels wide and queries four things, neither of which belongs in a dialog
 * that is already sitting on top of a live copy of it. What matters here is
 * only the *shape* — a rectangle of the right proportions with a banner band
 * and an avatar where the real ones are — because that's what tells you
 * whether your artwork is going to cover somebody's face.
 *
 * The frame itself is the real `ProfileFrameLayer`, so the geometry being
 * previewed is the geometry that will ship.
 */
function FramePlacementPreview({
  src,
  layout,
  avatarUrl,
  bannerUrl,
}: {
  src?: string;
  layout: ProfileFrameLayout;
  avatarUrl?: string;
  bannerUrl?: string;
}) {
  const room = frameHeadroom(layout, !!src);

  return (
    <div className="flex h-56 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-[repeating-conic-gradient(#0000_0_25%,#ffffff12_0_50%)] bg-[length:16px_16px]">
      {/* Scaled down as a whole, so the frame's pixel offsets stay in
          proportion to the card they're measured against. */}
      <div
        className="origin-center"
        style={{ transform: "scale(0.62)" }}
      >
        <div
          style={{
            paddingTop: room.paddingTop,
            paddingBottom: room.paddingBottom,
            paddingLeft: `${room.paddingInline}%`,
            paddingRight: `${room.paddingInline}%`,
          }}
        >
          <div className="relative h-[260px] w-[200px] rounded-md bg-accent p-0.5 shadow-lg">
            <div className="flex h-full flex-col overflow-hidden rounded-[5px] border border-border/20 bg-background/70">
              <div
                className="h-16 w-full bg-cover bg-center bg-muted"
                style={
                  bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined
                }
              />
              <div className="-mt-6 px-3">
                <div className="size-12 overflow-hidden rounded-xl bg-muted ring-4 ring-background/70">
                  {avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" className="size-full object-cover" />
                  )}
                </div>
              </div>
              <div className="space-y-1.5 px-3 pt-2">
                <div className="h-3 w-2/3 rounded bg-foreground/25" />
                <div className="h-2 w-1/2 rounded bg-foreground/15" />
                <div className="mt-3 h-2 w-full rounded bg-foreground/10" />
                <div className="h-2 w-4/5 rounded bg-foreground/10" />
              </div>
            </div>
            <ProfileFrameLayer src={src} layout={layout} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Uploading a frame, and — the part that actually matters — placing it.
 *
 * Frames are artwork of unknown shape. A border drawn to a card's proportions
 * and a tall piece meant to grow out of the card's top want opposite treatment,
 * and nothing in a PNG says which one you've got. So rather than this file
 * guessing, the person who just picked the file positions it against a live
 * card, and the four numbers they land on are stored with it.
 *
 * The preview is the real card from the editor behind this dialog, seen
 * through the dialog's own translucency — so there's no second implementation
 * of the geometry to drift. What's here is only the controls.
 */
export function ProfileFrameDialog({
  open,
  onOpenChange,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProfileScope;
}) {
  const current = scope.values?.profileFrame;
  const stored = frameLayout(scope.values ?? {});
  // Local while dragging: a slider fires per frame and each one would be a
  // write. Committed when the drag ends.
  const [draft, setDraft] = useState<ProfileFrameLayout>(stored);
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setDraft(stored);
  }
  if (!open && seeded) setSeeded(false);

  /** Applied straight away for the toggles, which are one click and want to be
   * seen on the card immediately. */
  const commit = (next: Partial<ProfileFrameLayout>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    void scope.setFrameLayout(next);
  };

  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Profile frame"
      description="Artwork drawn around your card. Position it against the card below."
      footer={
        <>
          <UploadButton
            label={current ? "Replace" : "Upload a frame"}
            maxBytes={MAX_PROFILE_ASSET_BYTES}
            maxLabel={MAX_PROFILE_ASSET_LABEL}
            onPick={(file) => scope.setFrame(file, "overlay")}
          />
          {current && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => void scope.removeFrame()}
            >
              Remove
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
{current ? (
          <FramePlacementPreview
            src={current}
            layout={draft}
            avatarUrl={scope.values?.imageUrl}
            bannerUrl={scope.values?.bannerUrl}
          />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-md border-2 border-dashed border-border/50 text-sm text-muted-foreground">
            Nothing uploaded yet
          </div>
        )}

        {current && (
          <>
            <div className="space-y-1.5">
              <Label>Shape</Label>
              <div className="grid grid-cols-2 gap-2">
                {FRAME_FITS.map((option) => (
                  <button
                    key={option.fit}
                    type="button"
                    aria-pressed={draft.fit === option.fit}
                    onClick={() => commit({ fit: option.fit })}
                    className={cn(
                      "rounded-md border p-2 text-left transition-colors",
                      draft.fit === option.fit
                        ? "border-primary bg-accent/60"
                        : "border-border hover:bg-accent/40",
                    )}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Anchor</Label>
              <div className="grid grid-cols-3 gap-2">
                {FRAME_ANCHORS.map((option) => (
                  <button
                    key={option.anchor}
                    type="button"
                    aria-pressed={draft.anchor === option.anchor}
                    onClick={() => commit({ anchor: option.anchor })}
                    className={cn(
                      "rounded-md border py-1.5 text-center text-sm transition-colors",
                      draft.anchor === option.anchor
                        ? "border-primary bg-accent/60"
                        : "border-border hover:bg-accent/40",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Which edge of the card the artwork is pinned to.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Size</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(draft.scale)}%
                </span>
              </div>
              <Slider
                value={[draft.scale]}
                min={FRAME_SCALE_RANGE.min}
                max={FRAME_SCALE_RANGE.max}
                step={1}
                onValueChange={([value]) =>
                  setDraft((prev) => ({ ...prev, scale: value ?? prev.scale }))
                }
                onValueCommit={([value]) =>
                  void scope.setFrameLayout({ scale: value ?? draft.scale })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Width, as a percentage of the card.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Offset</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(draft.offsetY)}px
                </span>
              </div>
              <Slider
                value={[draft.offsetY]}
                min={FRAME_OFFSET_RANGE.min}
                max={FRAME_OFFSET_RANGE.max}
                step={1}
                onValueChange={([value]) =>
                  setDraft((prev) => ({ ...prev, offsetY: value ?? prev.offsetY }))
                }
                onValueCommit={([value]) =>
                  void scope.setFrameLayout({ offsetY: value ?? draft.offsetY })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Negative moves it up, past the card's edge.
              </p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(DEFAULT_FRAME_LAYOUT);
                void scope.setFrameLayout(DEFAULT_FRAME_LAYOUT);
              }}
            >
              Reset placement
            </Button>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          A transparent PNG, GIF or WebP. Up to {MAX_PROFILE_ASSET_LABEL}.
        </p>
      </div>
    </CosmeticDialog>
  );
}

/* -------------------------------------------------------------------------- */

export function NameplateDialog({
  open,
  onOpenChange,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProfileScope;
}) {
  const current = scope.values?.nameplateUrl;
  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nameplate"
      description="The strip behind your name in chat. A picture or a short video."
      footer={
        <>
          <UploadButton
            label={current ? "Replace" : "Upload a nameplate"}
            maxBytes={MAX_PROFILE_ASSET_BYTES}
            maxLabel={MAX_PROFILE_ASSET_LABEL}
            accept={NAMEPLATE_ACCEPT}
            onPick={(file) => scope.setNameplate(file)}
          />
          {current && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => void scope.removeNameplate()}
            >
              Remove
            </Button>
          )}
        </>
      }
    >
      {/* `relative`, because `Nameplate` positions itself against its host the
          way it does behind a chat row — and at full opacity here, since this
          is the one place the nameplate is the subject rather than the
          backdrop. */}
      <div className="relative h-24 overflow-hidden rounded-md border border-border/50">
        {current ? (
          <Nameplate url={current} className="opacity-100 [mask-image:none]" />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
            No nameplate yet
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        A wide image, or a short muted video (WebM or MP4) — video plays on a
        loop behind your name. Up to {MAX_PROFILE_ASSET_LABEL}.
      </p>
    </CosmeticDialog>
  );
}
