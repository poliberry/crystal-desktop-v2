"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Upload } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GradientPicker } from "@/components/profile/gradient-picker";
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
import { DECORATION_PRESETS, isCustomDecoration } from "@/lib/avatar-decorations";
import {
  DISPLAY_NAME_STYLES,
  FRAME_MODES,
  frameMode,
  type ProfileFrameMode,
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
      description="Artwork played over the whole of your profile card, wherever it's shown."
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
  const mode = frameMode(scope.values?.profileFrameMode);
  // Remembered so an upload can carry the mode the user picked *before*
  // choosing a file, which is the order the two controls read in.
  const [pending, setPending] = useState<ProfileFrameMode>(mode);

  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Profile frame"
      description="A border drawn around your whole profile card — the avatar decoration idea, at card size."
      footer={
        <>
          <UploadButton
            label={current ? "Replace" : "Upload a frame"}
            maxBytes={MAX_PROFILE_ASSET_BYTES}
            maxLabel={MAX_PROFILE_ASSET_LABEL}
            onPick={(file) => scope.setFrame(file, pending)}
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
      <div className="space-y-3">
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-[repeating-conic-gradient(#0000_0_25%,#ffffff12_0_50%)] bg-[length:16px_16px]">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="" className="h-full w-full object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing uploaded yet</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>How it&apos;s drawn</Label>
          {FRAME_MODES.map((option) => {
            const selected = (current ? mode : pending) === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setPending(option.mode);
                  // Only meaningful once there's a frame to redraw; before
                  // that it's just the choice the next upload will carry.
                  if (current) void scope.setFrameMode(option.mode);
                }}
                className={cn(
                  "flex w-full flex-col items-start rounded-md border p-2.5 text-left transition-colors",
                  selected ? "border-primary bg-accent/60" : "border-border hover:bg-accent/40",
                )}
              >
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </button>
            );
          })}
        </div>

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
      description="The strip behind your name in chat."
      footer={
        <>
          <UploadButton
            label={current ? "Replace" : "Upload a nameplate"}
            maxBytes={MAX_PROFILE_ASSET_BYTES}
            maxLabel={MAX_PROFILE_ASSET_LABEL}
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
      <div className="h-24 overflow-hidden rounded-md border border-border/50">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
            No nameplate yet
          </div>
        )}
      </div>
    </CosmeticDialog>
  );
}
