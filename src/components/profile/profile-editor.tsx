"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import {
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BoardEditor } from "@/components/profile/board-editor";
import { ProfileCssDialog } from "@/components/profile/profile-css-dialog";
import {
  DecorationDialog,
  DisplayNameStyleDialog,
  NameplateDialog,
  ProfileEffectDialog,
  ProfileFrameDialog,
  ThemeDialog,
} from "@/components/profile/cosmetic-dialogs";
import {
  AVATAR_CROP,
  BANNER_CROP,
  ImageCropDialog,
} from "@/components/profile/image-crop-dialog";
import { MemberProfileCard } from "@/components/community/member-profile-card";
import { RichPresenceCards } from "@/components/rich-presence-card";
import { Avatar, AvatarDecoration, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useMyPresence } from "@/hooks/use-presence";
import { useProfileScope, type ProfileScope } from "@/hooks/use-profile-scope";
import { displayNameStyleClass } from "@/lib/profile-cosmetics";
import { type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

/**
 * The profile editor: a rail of cosmetics on the left, a live card in the
 * middle, and the Board on the right.
 *
 * The card in the middle is `MemberProfileCard` itself rather than a mock-up of
 * one, so what's being previewed is literally what everybody else will see —
 * every one of these cosmetics is a field on the profile, and a second
 * implementation of the card would drift away from the real one the first time
 * either changed.
 *
 * Cosmetics apply the moment they're chosen, because each is one field and an
 * upload has already happened by the time it's picked. The three text fields
 * are the exception and sit behind a Save button: they're typed rather than
 * chosen, and writing on every keystroke would be a mutation per character.
 */

const BIO_MAX = 300;

/** A section of the rail. */
function RailSection({
  label,
  badge,
  children,
}: {
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-foreground/90">{label}</p>
        {badge}
      </div>
      {children}
    </div>
  );
}

/**
 * A square preview tile — the rail's whole vocabulary.
 *
 * When there's nothing set yet it shows a dashed box with a plus, which is what
 * makes "you have none of these" and "you have one and here it is" the same
 * control rather than two.
 */
function RailTile({
  onClick,
  label,
  filled,
  className,
  children,
}: {
  onClick: () => void;
  label: string;
  filled: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "relative flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border transition-colors",
        filled
          ? "border-border/60 bg-muted/40 hover:border-primary/60"
          : "border-dashed border-border/60 bg-muted/20 hover:border-primary/60 hover:bg-accent/30",
        className,
      )}
    >
      {filled ? children : <Plus className="size-5 text-muted-foreground" />}
    </button>
  );
}

/** The "NEW" flag beside a section that has just shipped. */
function NewBadge() {
  return (
    <span className="rounded-sm bg-rose-500 px-1 py-px text-[9px] font-bold tracking-wide text-white">
      NEW
    </span>
  );
}

/** The scope picker — "Main Profile", or one of the servers you're in. */
function ScopeMenu({
  communityId,
  onChange,
  label,
}: {
  communityId?: Id<"communities">;
  onChange: (id: Id<"communities"> | undefined, name?: string) => void;
  label: string;
}) {
  const communities = useQuery(api.communities.listMine) ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-sm font-semibold hover:bg-accent/50"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => onChange(undefined)}>
          <span className="flex-1">Main Profile</span>
          {!communityId && <Check className="size-4" />}
        </DropdownMenuItem>
        {communities.map((community: any) => (
          <DropdownMenuItem
            key={community.id}
            onClick={() => onChange(community.id, community.name)}
          >
            <span className="flex-1 truncate">{community.name}</span>
            {communityId === community.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Name, bio and status — the part that's typed rather than picked. */
function DetailsForm({ scope }: { scope: ProfileScope }) {
  const values = scope.values;
  const [name, setName] = useState(values?.name ?? "");
  const [bio, setBio] = useState(values?.bio ?? "");
  const [customStatus, setCustomStatus] = useState(values?.customStatus ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Re-seeded whenever the scope changes underneath — switching from the
  // account to a server profile is a different set of values in the same
  // fields, and stale text would be saved into the new scope.
  const [seededFor, setSeededFor] = useState(scope.label);
  if (seededFor !== scope.label && values) {
    setSeededFor(scope.label);
    setName(values.name);
    setBio(values.bio);
    setCustomStatus(values.customStatus);
    setSaved(false);
  }

  const dirty =
    !!values &&
    (name !== values.name ||
      bio !== values.bio ||
      customStatus !== values.customStatus);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="pe-name" className="text-xs">
          Display name
        </Label>
        <Input
          id="pe-name"
          value={name}
          maxLength={64}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pe-status" className="text-xs">
          Custom status
        </Label>
        <Input
          id="pe-status"
          value={customStatus}
          maxLength={128}
          placeholder="What are you up to?"
          onChange={(e) => {
            setCustomStatus(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pe-bio" className="text-xs">
          Bio
        </Label>
        <Textarea
          id="pe-bio"
          rows={4}
          className="resize-none"
          value={bio}
          onChange={(e) => {
            setBio(e.target.value.slice(0, BIO_MAX));
            setSaved(false);
          }}
        />
        <p className="text-right text-[11px] text-muted-foreground">
          {bio.length}/{BIO_MAX}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await scope.saveText({ name, bio, customStatus });
              setSaved(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
        {saved && !dirty && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
      </div>
    </div>
  );
}

export function ProfileEditor({
  /** Rendered by the host that owns the close affordance — the Settings
   * dialog draws its own, the full-page route draws none. */
  onRequestClose,
  className,
}: {
  onRequestClose?: () => void;
  className?: string;
}) {
  const me = useQuery(api.users.getCurrentUser);
  const { status, activities } = useMyPresence();

  const [scopeId, setScopeId] = useState<Id<"communities"> | undefined>(undefined);
  const [scopeName, setScopeName] = useState<string | undefined>(undefined);
  const scope = useProfileScope(scopeId, scopeName);
  const values = scope.values;

  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState<"board" | "activity">("board");
  const [dialog, setDialog] = useState<
    | null
    | "nameplate"
    | "decoration"
    | "nameStyle"
    | "theme"
    | "effect"
    | "frame"
    | "css"
  >(null);
  /** The crop editor is owned here rather than by the theme dialog, so a crop
   * never opens on top of another dialog. */
  const [cropping, setCropping] = useState<{
    kind: "avatar" | "banner";
    source: File | string;
  } | null>(null);

  if (!me || !values) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const saveCrop = async (crop: Blob) => {
    const target = cropping;
    if (!target) return;
    const original = target.source instanceof File ? target.source : undefined;
    if (target.kind === "avatar") await scope.setAvatar(crop, original);
    else await scope.setBanner(crop, original);
  };

  return (
    <div className={cn("flex h-full min-h-0 overflow-hidden bg-background", className)}>
      {/* ---------------------------------------------------------------- */}
      {/* Left rail                                                         */}
      {/* ---------------------------------------------------------------- */}
      <aside
        className={cn(
          "flex min-h-0 shrink-0 flex-col border-r border-border/40 bg-card/40 transition-[width] duration-200",
          wide ? "w-[380px]" : "w-[260px]",
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
          <ScopeMenu
            communityId={scopeId}
            label={scopeId ? (scopeName ?? "Server Profile") : "Main Profile"}
            onChange={(id, name) => {
              setScopeId(id);
              setScopeName(name);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={wide ? "Narrow the panel" : "Widen the panel"}
            title={wide ? "Narrow the panel" : "Widen the panel to edit your details"}
            onClick={() => setWide((w) => !w)}
          >
            {wide ? (
              <ChevronsLeft className="size-4" />
            ) : (
              <ChevronsRight className="size-4" />
            )}
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-3 pb-6">
            <RailSection label="Nameplate">
              <RailTile
                onClick={() => setDialog("nameplate")}
                label="Edit nameplate"
                filled={!!values.nameplateUrl}
                className="h-12"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={values.nameplateUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </RailTile>
            </RailSection>

            <RailSection label="Avatar & Decoration">
              <div className="grid grid-cols-2 gap-2">
                <RailTile
                  onClick={() => {
                    // A fresh pick rather than a re-crop: re-cropping is
                    // offered from the crop editor's own entry point below.
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (file) setCropping({ kind: "avatar", source: file });
                    };
                    input.click();
                  }}
                  label="Change avatar"
                  filled={!!values.imageUrl}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={values.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </RailTile>
                <RailTile
                  onClick={() => setDialog("decoration")}
                  label="Change avatar decoration"
                  filled
                >
                  <Avatar className="size-14 rounded-xl">
                    <AvatarImage src={values.imageUrl} className="rounded-xl" />
                    <AvatarFallback>
                      {values.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                    <AvatarDecoration value={values.avatarDecoration}
                      animate
                    />
                  </Avatar>
                </RailTile>
              </div>
              {values.avatarOriginalUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() =>
                    setCropping({
                      kind: "avatar",
                      source: values.avatarOriginalUrl as string,
                    })
                  }
                >
                  Adjust avatar crop
                </Button>
              )}
            </RailSection>

            <RailSection label="Display Name Style" badge={<NewBadge />}>
              <button
                type="button"
                onClick={() => setDialog("nameStyle")}
                className="flex h-12 w-full items-center justify-center rounded-lg border border-border/60 bg-muted/30 px-3 transition-colors hover:border-primary/60"
              >
                <span
                  className={cn(
                    "truncate text-lg font-bold",
                    displayNameStyleClass(values.displayNameStyle),
                  )}
                >
                  {values.name}
                </span>
              </button>
            </RailSection>

            <RailSection label="Theme & Banner">
              <div className="grid grid-cols-2 gap-2">
                <RailTile
                  onClick={() => setDialog("theme")}
                  label="Edit theme"
                  filled
                  className="border-solid"
                >
                  {/* The gradient itself, as its own swatch — the two circles
                      stand in for the card's avatar and its frame. */}
                  <span
                    className="flex h-full w-full flex-col items-center justify-center gap-2"
                    style={{
                      background:
                        values.borderGradientStart && values.borderGradientEnd
                          ? `linear-gradient(to bottom, ${values.borderGradientStart}, ${values.borderGradientEnd})`
                          : undefined,
                    }}
                  >
                    <span className="size-5 rounded-md border-2 border-white/80" />
                    <span className="size-5 rounded-md border-2 border-white/80" />
                  </span>
                </RailTile>
                <RailTile
                  onClick={() => setDialog("theme")}
                  label="Edit banner"
                  filled={!!values.bannerUrl}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={values.bannerUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </RailTile>
              </div>
            </RailSection>

            <RailSection label="Profile Effect & Frame" badge={<NewBadge />}>
              <div className="grid grid-cols-2 gap-2">
                <RailTile
                  onClick={() => setDialog("effect")}
                  label="Edit profile effect"
                  filled={!!values.profileEffect}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={values.profileEffect}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </RailTile>
                <RailTile
                  onClick={() => setDialog("frame")}
                  label="Edit profile frame"
                  filled={!!values.profileFrame}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={values.profileFrame}
                    alt=""
                    className="h-full w-full object-contain p-1"
                  />
                </RailTile>
              </div>
            </RailSection>

            <RailSection label="Profile CSS" badge={<NewBadge />}>
              <button
                type="button"
                onClick={() => setDialog("css")}
                className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-left transition-colors hover:border-primary/60"
              >
                <Code2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">
                    {values.profileCss ? "Edit your styles" : "Style this card"}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {values.profileCss
                      ? `${values.profileCss.length} characters`
                      : "CSS that applies to your card only."}
                  </span>
                </span>
              </button>
            </RailSection>

            {/* Only in the wide rail: the cosmetics above are the point of
                this panel, and pushing them up out of sight behind three text
                fields would be the wrong trade at 260 pixels. */}
            {wide && (
              <RailSection label="Details">
                <DetailsForm scope={scope} />
              </RailSection>
            )}

            {!wide && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setWide(true)}
              >
                Edit name, status & bio
              </Button>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Live card                                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="min-h-0 shrink-0 p-4">
        <ScrollArea className="h-full">
          {/* The card reserves its own room for the frame — see
              MemberProfileCard. This only has to be wide enough. */}
          <div className="w-[360px] px-4">
            <MemberProfileCard
              expandable={false}
              expanded
              showActivity={false}
              communityId={scopeId}
              communityName={scopeName}
              member={{
                userId: me._id,
                name: values.name,
                username: me.username,
                imageUrl: values.imageUrl,
                bio: values.bio,
                customStatus: values.customStatus,
                bannerUrl: values.bannerUrl,
                avatarDecoration: values.avatarDecoration,
                borderGradientStart: values.borderGradientStart,
                borderGradientEnd: values.borderGradientEnd,
                displayNameStyle: values.displayNameStyle,
                profileEffect: values.profileEffect,
                profileFrame: values.profileFrame,
                profileFrameMode: values.profileFrameMode,
                profileFrameFit: values.profileFrameFit,
                profileFrameAnchor: values.profileFrameAnchor,
                profileFrameScale: values.profileFrameScale,
                profileFrameOffsetY: values.profileFrameOffsetY,
                profileCss: values.profileCss,
                status: status as FriendStatus,
              }}
            />
          </div>
        </ScrollArea>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Board / Activity                                                  */}
      {/* ---------------------------------------------------------------- */}
      {/* `relative z-10`: a frame or effect on the preview card hangs outside
          it by design, and this pane must stay clickable underneath none of
          it. */}
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col p-4 pt-4">
        <div className="relative mb-3 flex items-center gap-4 border-b border-border/40">
          {(["board", "activity"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "border-b-2 pb-2 text-sm font-semibold capitalize transition-colors",
                tab === value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
          {onRequestClose && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto mb-1"
              aria-label="Close"
              onClick={onRequestClose}
            >
              ✕
            </Button>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="pr-3 pb-4">
            {tab === "board" ? (
              <BoardEditor communityId={scopeId} scopeLabel={scope.label} />
            ) : activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 py-10 text-center text-sm text-muted-foreground">
                <Sparkles className="size-5" />
                <p>Nothing right now.</p>
              </div>
            ) : (
              <RichPresenceCards activities={activities} stack={false} />
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Dialogs ---------------------------------------------------------- */}
      <NameplateDialog
        open={dialog === "nameplate"}
        onOpenChange={(o) => setDialog(o ? "nameplate" : null)}
        scope={scope}
      />
      <DecorationDialog
        open={dialog === "decoration"}
        onOpenChange={(o) => setDialog(o ? "decoration" : null)}
        imageUrl={values.imageUrl}
        name={values.name}
        current={values.avatarDecoration}
        isAccount={scope.isAccount}
        scope={scope}
        scopeId={scopeId}
        scopeName={scopeName}
      />
      <DisplayNameStyleDialog
        open={dialog === "nameStyle"}
        onOpenChange={(o) => setDialog(o ? "nameStyle" : null)}
        name={values.name}
        current={values.displayNameStyle}
        scope={scope}
      />
      <ThemeDialog
        open={dialog === "theme"}
        onOpenChange={(o) => setDialog(o ? "theme" : null)}
        scope={scope}
        onPickBanner={() => {
          setDialog(null);
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = () => {
            const file = input.files?.[0];
            if (file) setCropping({ kind: "banner", source: file });
          };
          input.click();
        }}
      />
      <ProfileEffectDialog
        open={dialog === "effect"}
        onOpenChange={(o) => setDialog(o ? "effect" : null)}
        scope={scope}
      />
      <ProfileFrameDialog
        open={dialog === "frame"}
        onOpenChange={(o) => setDialog(o ? "frame" : null)}
        scope={scope}
        scopeId={scopeId}
        scopeName={scopeName}
      />
      <ProfileCssDialog
        open={dialog === "css"}
        onOpenChange={(o) => setDialog(o ? "css" : null)}
        scope={scope}
      />

      <ImageCropDialog
        open={!!cropping}
        onOpenChange={(open) => !open && setCropping(null)}
        source={cropping?.source ?? null}
        shape={cropping?.kind === "banner" ? BANNER_CROP : AVATAR_CROP}
        title={cropping?.kind === "banner" ? "Position your banner" : "Position your avatar"}
        onCropped={saveCrop}
      />
    </div>
  );
}
