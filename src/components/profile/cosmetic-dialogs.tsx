"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Upload } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GradientPicker } from "@/components/profile/gradient-picker";
import {
  LayerEditor,
  type StageHeightOption,
} from "@/components/profile/layer-editor";
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
import {
  DECORATION_PRESETS,
  decorationLayers,
  decorationSrc,
} from "@/lib/avatar-decorations";
import { CARD_VARIANTS, DEFAULT_VARIANT, MAX_LAYERS } from "@/lib/cosmetic-layers";
import {
  DEFAULT_FRAME_LAYOUT,
  DISPLAY_NAME_STYLES,
  FRAME_ANCHORS,
  FRAME_FITS,
  FRAME_OFFSET_RANGE,
  FRAME_SCALE_RANGE,
  frameLayersFrom,
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
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** For the two that hold a canvas: a picker needs a dialog, an editor needs
   * a workspace. */
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          wide
            ? [
                // The whole window bar the app's own chrome. A canvas is a
                // workspace: the more of the card and the artwork around it
                // you can see at once, the less of the job is scrolling.
                //
                // All of it in classes, none of it inline. The dialog animates
                // itself in with a transform, so an inline one fights the
                // animation — and "sm:max-w-lg" is what a plain "max-w-none"
                // silently loses to, since a responsive variant and a bare
                // utility are different rules rather than the same one twice.
                //
                // 64px is APP_TOP_CHROME_PX plus a 12px margin, and the height
                // is the window less that and the same margin at the bottom.
                // Written out because Tailwind reads these at build time and
                // cannot be handed a number.
                "top-16 h-[calc(100vh-76px)] max-h-none w-[calc(100vw-24px)] translate-y-0",
                "flex max-w-none flex-col overflow-hidden sm:max-w-none",
              ]
            : "sm:max-w-lg",
        )}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* `min-h-0`: the canvas inside is a flex child that has to be allowed
            to be shorter than its content, or it pushes the footer off. */}
        <div className={cn(wide && "flex min-h-0 flex-1 flex-col")}>{children}</div>
        {footer && <DialogFooter className="shrink-0">{footer}</DialogFooter>}
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
 * Arranging what goes around an avatar.
 *
 * A canvas rather than a row of swatches, because a decoration is a list of
 * placed pictures now: the presets are still one click, but they arrive *as*
 * layers, so one can be dropped behind an uploaded badge and both can be moved.
 * What you drag against is an avatar at the size a profile card draws one, and
 * the geometry is in percentages of it — so an arrangement made here is the
 * same arrangement at 24 pixels in a member list.
 */
export function DecorationDialog({
  open,
  onOpenChange,
  imageUrl,
  name,
  current,
  isAccount,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl?: string;
  name: string;
  /** The decoration as stored — any of its forms; `decorationLayers` unpacks
   * the lot, so an old single-image one opens as one layer to drag. */
  current?: string;
  isAccount: boolean;
  scope: ProfileScope;
}) {
  const removeAvatarDecoration = useMutation(api.users.removeAvatarDecoration);
  const layers = useMemo(() => decorationLayers(current), [current]);

  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Avatar decoration"
      description={
        isAccount
          ? "Artwork worn around your avatar wherever you appear. Drag it to place it."
          : "Decorations are worn by you rather than by one server identity, so this applies everywhere."
      }
      footer={
        layers.length > 0 && (
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => void removeAvatarDecoration()}
          >
            Remove all
          </Button>
        )
      }
    >
      <LayerEditor
        className="min-h-0 flex-1"
        layers={layers}
        onSave={(next) => scope.setDecorationLayers(next)}
        stageWidth={AVATAR_STAGE_PX}
        // One shape only: an avatar is a square at every size the app draws
        // one, so there is nothing to check a decoration against but itself.
        // One shape, and it is the default one: an avatar is a square at every
        // size the app draws one, so there is nothing to place a decoration
        // against twice.
        heights={[{ key: DEFAULT_VARIANT, label: "Avatar", height: AVATAR_STAGE_PX }]}
        upload={scope.uploadLayerImage}
        uploadHint={`Transparent PNG, GIF or WebP works best. Up to ${MAX_DECORATION_LABEL} each.`}
        presets={DECORATION_PRESETS.map((preset) => ({
          label: preset.name,
          // The stored form, not the picture: a layer keeps the key so a
          // preset redrawn in a later build is redrawn for everyone wearing it.
          url: preset.value,
        }))}
        resolveSrc={(url) => decorationSrc(url) ?? url}
        renderStage={() => (
          <div className="flex size-full items-center justify-center">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt=""
                className="size-full rounded-2xl object-cover"
                draggable={false}
              />
            ) : (
              <span className="flex size-full items-center justify-center rounded-2xl bg-muted text-2xl text-muted-foreground">
                {name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        )}
      />
    </CosmeticDialog>
  );
}

/** The avatar the canvas draws against, in pixels. Big enough to place
 * something on, and square, which is the only thing that matters — the
 * geometry is relative, so the number itself never leaves this file. */
const AVATAR_STAGE_PX = 132;


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
 * A card to arrange a frame against, at a height you choose.
 *
 * A stand-in rather than the real `MemberProfileCard`: the real one queries
 * four things and sizes itself from what somebody has written, and neither
 * belongs in a dialog whose whole purpose is to show the *shapes* a card comes
 * in. What matters here is where the banner ends, where the avatar sits, and
 * how far down the card goes — because those are what artwork either lines up
 * with or covers.
 *
 * The height is the point. A card grows with a long bio or a rich presence
 * card, sometimes by half again, and a frame placed against a short one is a
 * frame nobody has checked.
 */
function CardStage({
  height,
  avatarUrl,
  bannerUrl,
  name,
}: {
  height: number;
  avatarUrl?: string;
  bannerUrl?: string;
  name: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-md border border-border/20 bg-accent shadow-lg"
      style={{ height }}
    >
      <div
        className="h-20 w-full bg-muted bg-cover bg-center"
        style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
      />
      <div className="-mt-8 px-4">
        <div className="size-16 overflow-hidden rounded-xl bg-muted ring-4 ring-background/70">
          {avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="size-full object-cover" draggable={false} />
          )}
        </div>
      </div>
      <div className="space-y-2 px-4 pt-3">
        <p className="truncate text-lg leading-tight font-bold">{name || "Your name"}</p>
        <div className="h-2 w-1/2 rounded bg-foreground/15" />
        <div className="mt-4 space-y-1.5">
          <div className="h-2 w-full rounded bg-foreground/10" />
          <div className="h-2 w-4/5 rounded bg-foreground/10" />
          <div className="h-2 w-2/3 rounded bg-foreground/10" />
        </div>
        {/* Only drawn on the taller cards, because that is what makes a card
            taller: something else to say. */}
        {height > 460 && (
          <div className="mt-4 h-24 rounded-md border border-border/40 bg-muted/40" />
        )}
        {height > 560 && (
          <div className="mt-3 h-20 rounded-md border border-border/40 bg-muted/40" />
        )}
      </div>
    </div>
  );
}

/**
 * Uploading a frame, and — the part that actually matters — arranging it.
 *
 * Frames are artwork of unknown shape, and there are several of them now: a
 * border, a badge in a corner, a shine over the top. Nothing in a PNG says
 * where it belongs, so the person who picked the files places them, against a
 * card they can make short or tall to see what happens when somebody writes a
 * long bio.
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
  const values = scope.values;
  const layers = useMemo(() => frameLayersFrom(values ?? {}), [values]);

  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Profile frame"
      description="Artwork drawn around your card. Drag it into place, and check it against a card that has grown."
      footer={
        (values?.profileFrame || layers.length > 0) && (
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              void scope.setFrameLayers([]);
              void scope.removeFrame();
            }}
          >
            Remove all
          </Button>
        )
      }
    >
      <LayerEditor
        className="min-h-0 flex-1"
        layers={layers}
        onSave={(next) => scope.setFrameLayers(next)}
        stageWidth={CARD_STAGE_WIDTH_PX}
        heights={CARD_HEIGHTS}
        upload={scope.uploadLayerImage}
        uploadHint={`Transparent PNG, GIF or WebP. Up to ${MAX_PROFILE_ASSET_LABEL} each, ${MAX_LAYERS} in total.`}
        renderStage={(height) => (
          <CardStage
            height={height}
            avatarUrl={values?.imageUrl}
            bannerUrl={values?.bannerUrl}
            name={values?.name ?? ""}
          />
        )}
      />
    </CosmeticDialog>
  );
}

/** The width a profile card is drawn at — the popover's `w-72` plus the room
 * the page gives it. Layer geometry is a percentage of this. */
const CARD_STAGE_WIDTH_PX = 300;

/**
 * The heights a card comes in, from the shapes themselves.
 *
 * Derived rather than written out, because these keys are also what a
 * per-shape placement is stored under and what the renderer matches a real
 * card against — three lists of the same three things would drift the first
 * time anybody added a fourth.
 */
const CARD_HEIGHTS: StageHeightOption[] = CARD_VARIANTS.map((variant) => ({
  key: variant.key,
  label: variant.label,
  hint: variant.hint,
  height: Math.round((CARD_STAGE_WIDTH_PX * variant.heightPercent) / 100),
}));


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
