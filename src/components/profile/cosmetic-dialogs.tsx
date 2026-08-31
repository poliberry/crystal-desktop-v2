"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Loader2, Upload } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  MemberProfileCard,
  type MemberProfileMember,
} from "@/components/community/member-profile-card";
import { GradientPicker } from "@/components/profile/gradient-picker";
import {
  LayerEditor,
  type StageHeightOption,
} from "@/components/profile/layer-editor";
import { Nameplate, NAMEPLATE_ACCEPT } from "@/components/profile/nameplate";
import { APP_TOP_CHROME_PX } from "@/components/profile/profile-popover";
import type { RichPresenceActivity } from "@/types/desktop-api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getDesktopAPI, isElectron } from "@/lib/desktop";
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
import type { ProfileScope, ProfileScopeValues } from "@/hooks/use-profile-scope";

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

/**
 * "Open in its own window" — the canvas editors' escape hatch from a dialog
 * pinned to the size of the main window.
 *
 * Electron-only: there's no second window to open in a browser tab, and
 * `getDesktopAPI()` is `undefined` there, so this quietly draws nothing
 * rather than a button that can't work. The new window is handed nothing but
 * which profile to edit — see `DesktopAPI.editor` — because it loads
 * `/editor` itself and gets a working Convex session for free, the same
 * origin the main window is already signed in on.
 */
function PopOutButton({
  kind,
  scopeId,
  scopeName,
  onOpened,
}: {
  kind: "frame" | "decoration";
  scopeId?: Id<"communities">;
  scopeName?: string;
  /** Closes the in-dialog editor once the window has it — editing in both
   * places at once is two drafts racing to save last. */
  onOpened: () => void;
}) {
  if (!isElectron()) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-xs"
      title="Open in its own window"
      onClick={() => {
        void getDesktopAPI()?.editor.open({ kind, scopeId, scopeName });
        onOpened();
      }}
    >
      <ExternalLink className="size-3.5" />
      Pop out
    </Button>
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
/**
 * The decoration editor's insides — everything but the dialog chrome, so the
 * `/editor` pop-out window (`src/app/editor/page.tsx`) can render exactly
 * this without dragging a `<Dialog>` it isn't inside of along with it.
 */
export function DecorationEditor({
  imageUrl,
  name,
  current,
  scope,
  className,
}: {
  imageUrl?: string;
  name: string;
  /** The decoration as stored — any of its forms; `decorationLayers` unpacks
   * the lot, so an old single-image one opens as one layer to drag. */
  current?: string;
  scope: ProfileScope;
  className?: string;
}) {
  const layers = useMemo(() => decorationLayers(current), [current]);
  return (
    <LayerEditor
      className={className}
      layers={layers}
      onSave={(next) => scope.setDecorationLayers(next)}
      // One shape, and it is the default one: an avatar is a square at every
      // size the app draws one, so there is nothing to place a decoration
      // against twice.
      stages={[
        {
          key: DEFAULT_VARIANT,
          label: "Avatar",
          width: AVATAR_STAGE_PX,
          height: AVATAR_STAGE_PX,
        },
      ]}
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
  );
}

export function DecorationDialog({
  open,
  onOpenChange,
  imageUrl,
  name,
  current,
  isAccount,
  scope,
  scopeId,
  scopeName,
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
  /** Which profile this is, for the pop-out window — see `PopOutButton`. */
  scopeId?: Id<"communities">;
  scopeName?: string;
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
        (isElectron() || layers.length > 0) && (
          <>
            <PopOutButton
              kind="decoration"
              scopeId={scopeId}
              scopeName={scopeName}
              onOpened={() => onOpenChange(false)}
            />
            {layers.length > 0 && (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => void removeAvatarDecoration()}
              >
                Remove all
              </Button>
            )}
          </>
        )
      }
    >
      <DecorationEditor
        className="min-h-0 flex-1"
        imageUrl={imageUrl}
        name={name}
        current={current}
        scope={scope}
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


/** A placeholder line of the length real body copy tends to run, so the "bio"
 * and "activity" shapes grow by roughly what a paragraph actually costs even
 * when the profile being edited has no bio written yet. */
const BIO_PLACEHOLDER =
  "Say something about yourself here — a line or two is usually about this long, sometimes wrapping to a third.";

/** A stand-in "playing something" for the `*-activity` states, so the tallest
 * card can be arranged against without the editor's owner actually
 * broadcasting a game. Deliberately plain — no position bar, no artwork — so
 * it costs about what a real one does and doesn't tick a clock 12 times a
 * second across every mounted copy. */
const PREVIEW_ACTIVITIES: RichPresenceActivity[] = [
  {
    type: "playing",
    name: "A game",
    details: "In a match",
    state: "Round 3 of 5",
  },
];

/** The other states pass this so a real, live activity the owner happens to be
 * broadcasting doesn't make the "no activity" cards taller than they should be.
 * One shared array, so it isn't a new prop identity every render. */
const NO_ACTIVITIES: RichPresenceActivity[] = [];

/** Two roles to arrange against, for the "show roles" toggle. The ids are fake
 * — nothing here reads them — and the colours are just so the row looks like a
 * row of roles rather than one grey pill. */
const PREVIEW_ROLES: NonNullable<MemberProfileMember["roles"]> = [
  { id: "preview-mod" as Id<"roles">, name: "Moderator", color: "#5865f2" },
  { id: "preview-supporter" as Id<"roles">, name: "Early supporter" },
];

/** Which parts of the card the frame is being arranged against. The bio and the
 * rich-presence card are decided by the card *state* (there's a `-bio` and a
 * `-activity` state); everything here is a part that any state can carry. */
interface FrameElementToggles {
  banner: boolean;
  badges: boolean;
  roles: boolean;
  memberSince: boolean;
  buttons: boolean;
}

const DEFAULT_ELEMENT_TOGGLES: FrameElementToggles = {
  banner: true,
  badges: true,
  roles: true,
  memberSince: true,
  buttons: true,
};

const ELEMENT_TOGGLE_LABELS: { key: keyof FrameElementToggles; label: string }[] = [
  { key: "banner", label: "Banner" },
  { key: "badges", label: "Badges" },
  { key: "roles", label: "Roles" },
  { key: "memberSince", label: "Member since" },
  { key: "buttons", label: "Buttons" },
];

/**
 * A real `MemberProfileCard` in one of its states, for the frame to be arranged
 * against.
 *
 * The card used to be a diagram of the real one drawn from the same Tailwind
 * classes — which drifted the moment anyone touched a padding. This is the
 * component itself, rendered with `frameHandledByHost` so it draws everything
 * *but* the frame (the editor draws that), the profile's own draft values, and
 * a fixed width so its geometry is a known number of pixels.
 *
 * `state` is one of `CARD_VARIANTS`: its `sizeClass` picks the popover vs
 * full-page width and layout, and its key's suffix (`-bio` / `-activity`) turns
 * on the bio and a stand-in rich-presence card. The `toggles` hide the parts
 * that aren't part of that matrix — a badge row, the join date — by CSS on the
 * `data-slot`s the card already ships, which is cheaper than a prop each.
 */
function CardStage({
  state,
  toggles,
  values,
  userId,
  username,
  height,
  measureRef,
}: {
  state: (typeof CARD_VARIANTS)[number];
  toggles: FrameElementToggles;
  values: ProfileScopeValues;
  userId: Id<"users">;
  username: string;
  /** Forced, for a card on the canvas — the measured height of this state.
   * Omitted for the off-screen copies, whose whole job is to settle on one. */
  height?: number;
  measureRef?: React.Ref<HTMLDivElement>;
}) {
  const expanded = state.sizeClass === "expanded";
  // The full page always shows a bio and the join date (see the screenshots);
  // the popover splits into a plain / bio / playing set.
  const wantsBio =
    expanded || state.key.endsWith("-bio") || state.key.endsWith("-activity");
  const wantsActivity = state.key.endsWith("-activity");

  const member: MemberProfileMember = {
    userId,
    name: values.name || "Your name",
    username,
    imageUrl: values.imageUrl,
    bio: wantsBio ? values.bio.trim() || BIO_PLACEHOLDER : undefined,
    bannerUrl: toggles.banner ? values.bannerUrl : undefined,
    customStatus: values.customStatus || undefined,
    avatarDecoration: values.avatarDecoration,
    borderGradientStart: values.borderGradientStart,
    borderGradientEnd: values.borderGradientEnd,
    displayNameStyle: values.displayNameStyle,
    status: "online",
    roles: toggles.roles ? PREVIEW_ROLES : undefined,
  };

  return (
    <div
      ref={measureRef}
      style={{ width: state.widthPx, ...(height === undefined ? {} : { height }) }}
      className={cn(
        "shrink-0",
        height !== undefined && "h-full",
        !toggles.badges && "[&_[data-slot=profile-badges]]:hidden",
        !toggles.memberSince && "[&_[data-slot=profile-member-since]]:hidden",
        !toggles.buttons && "[&_[data-slot=profile-actions]]:hidden",
      )}
    >
      <MemberProfileCard
        className={height === undefined ? undefined : "h-full"}
        member={member}
        expanded={expanded}
        expandable={false}
        hideMessageAction
        frameHandledByHost
        reserveFrameRoom={false}
        previewActivities={wantsActivity ? PREVIEW_ACTIVITIES : NO_ACTIVITIES}
      />
    </div>
  );
}

/**
 * The real height each card state comes out to, measured rather than assumed.
 *
 * One off-screen copy of `CardStage` per state, at the state's real width with
 * nothing forcing its height, each with a `ResizeObserver` — which is what "the
 * card's shape" has to mean once a bio can be one line or four and a rich
 * presence card can be there or not. `CARD_VARIANTS.heightPercent` is only the
 * value shown before the first measurement lands.
 *
 * `fixed` states are skipped: their height is a box, not their content (the
 * full page sizes the card to the column), so measuring a free-standing copy
 * would settle on the content height and miss the point. They keep the
 * `heightPercent` fallback.
 */
function useMeasuredCardHeights(
  toggles: FrameElementToggles,
  values: ProfileScopeValues | null,
  userId: Id<"users"> | undefined,
  username: string,
) {
  const [heights, setHeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      CARD_VARIANTS.map((variant) => [
        variant.key,
        Math.round((variant.widthPx * variant.heightPercent) / 100),
      ]),
    ),
  );

  const measure = useCallback((key: string, node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(
        entry!.borderBoxSize?.[0]?.blockSize ?? entry!.contentRect.height,
      );
      if (next > 0) setHeights((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
    });
    observer.observe(node);
  }, []);

  const offscreen =
    values && userId ? (
      <div
        aria-hidden
        className="pointer-events-none fixed -left-[9999px] top-0 -z-50 opacity-0"
      >
        {CARD_VARIANTS.filter((variant) => !variant.fixed).map((variant) => (
          <CardStage
            key={variant.key}
            state={variant}
            toggles={toggles}
            values={values}
            userId={userId}
            username={username}
            measureRef={(node) => measure(variant.key, node)}
          />
        ))}
      </div>
    ) : null;

  return { heights, offscreen };
}

/**
 * How tall the card is drawn on the full profile page, in CSS pixels.
 *
 * The page hands the card column the window less its own chrome and then draws
 * the card at 120% of that (see profile-page.tsx) — so the card has dead space
 * below the buttons and the frame is drawn around the whole box. This
 * reproduces that number so the `expanded-page` stage matches what the frame
 * lands on for real. Recomputed on resize.
 */
function usePageCardHeight(): number {
  const estimate = () => {
    if (typeof window === "undefined") return 1080;
    // 96 for the profile page's own header row and padding above the column.
    const column = Math.max(360, window.innerHeight - APP_TOP_CHROME_PX - 96);
    return Math.round(column * 1.2);
  };
  const [height, setHeight] = useState(estimate);
  useEffect(() => {
    const onResize = () => setHeight(estimate());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
}

/**
 * The frame editor's insides — everything but the dialog chrome, so the
 * `/editor` pop-out window can render exactly this without a `<Dialog>` it
 * isn't inside of.
 *
 * Every card state is shown at once (see `LayerEditor`), each a real
 * `MemberProfileCard` at its measured height, and the element toggles drive
 * every one of them.
 */
export function ProfileFrameEditor({
  scope,
  className,
}: {
  scope: ProfileScope;
  className?: string;
}) {
  const values = scope.values;
  const me = useQuery(api.users.getCurrentUser);
  const userId = me?._id;
  const username = me?.username ?? "you";
  const layers = useMemo(() => frameLayersFrom(values ?? {}), [values]);
  const [toggles, setToggles] = useState(DEFAULT_ELEMENT_TOGGLES);
  const { heights: measured, offscreen } = useMeasuredCardHeights(
    toggles,
    values,
    userId,
    username,
  );
  const pageCardHeight = usePageCardHeight();

  const stages: StageHeightOption[] = useMemo(
    () =>
      CARD_VARIANTS.map((variant) => ({
        key: variant.key,
        label: variant.label,
        hint: variant.hint,
        width: variant.widthPx,
        // A fixed state is a box, not its content — drawn at the size the real
        // page gives it rather than at whatever a free card measured.
        height: variant.fixed
          ? pageCardHeight
          : measured[variant.key] ??
            Math.round((variant.widthPx * variant.heightPercent) / 100),
      })),
    [measured, pageCardHeight],
  );

  return (
    <>
      {/* Rendered, not shown: this is what measures every state above. */}
      {offscreen}
      <LayerEditor
        className={className}
        layers={layers}
        onSave={(next) => scope.setFrameLayers(next)}
        stages={stages}
        upload={scope.uploadLayerImage}
        uploadHint={`Transparent PNG, GIF or WebP. Up to ${MAX_PROFILE_ASSET_LABEL} each, ${MAX_LAYERS} in total.`}
        elementToggles={
          <div className="flex flex-col gap-1.5">
            {ELEMENT_TOGGLE_LABELS.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-2 text-xs"
              >
                {label}
                <Switch
                  checked={toggles[key]}
                  onCheckedChange={(checked) =>
                    setToggles((prev) => ({ ...prev, [key]: checked }))
                  }
                />
              </label>
            ))}
          </div>
        }
        renderStage={(stage) => {
          const variant = CARD_VARIANTS.find((option) => option.key === stage.key);
          if (!variant || !values || !userId) return null;
          return (
            <CardStage
              state={variant}
              toggles={toggles}
              values={values}
              userId={userId}
              username={username}
              height={stage.height}
            />
          );
        }}
      />
    </>
  );
}

export function ProfileFrameDialog({
  open,
  onOpenChange,
  scope,
  scopeId,
  scopeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProfileScope;
  /** Which profile this is, for the pop-out window — see `PopOutButton`. */
  scopeId?: Id<"communities">;
  scopeName?: string;
}) {
  const values = scope.values;
  const hasFrame = !!(values?.profileFrame || (values?.profileFrameLayers?.length ?? 0) > 0);

  return (
    <CosmeticDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Profile frame"
      description="Artwork drawn around your card. Drag it into place, and check it against a card that has grown."
      footer={
        (isElectron() || hasFrame) && (
          <>
            <PopOutButton
              kind="frame"
              scopeId={scopeId}
              scopeName={scopeName}
              onOpened={() => onOpenChange(false)}
            />
            {hasFrame && (
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
            )}
          </>
        )
      }
    >
      <ProfileFrameEditor className="min-h-0 flex-1" scope={scope} />
    </CosmeticDialog>
  );
}

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
