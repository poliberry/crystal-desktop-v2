"use client";

import { CosmeticMedia } from "@/components/motion/cosmetic-media";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Code2, Loader2, Plus, Sparkles, Sticker } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BoardEditor } from "@/components/profile/board-editor";
import { PageSidebar } from "@/components/pages/page-sidebar";
import { ProfileCssDialog } from "@/components/profile/profile-css-dialog";
import {
  DecorationDialog,
  DisplayNameStyleDialog,
  ProfileEffectDialog,
  ProfileStickersDialog,
  ThemeDialog,
} from "@/components/profile/cosmetic-dialogs";
import {
  ProfileImagesDialog,
  type ProfileImageKind,
} from "@/components/profile/profile-images-dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMyPresence } from "@/hooks/use-presence";
import { useProfileScope } from "@/hooks/use-profile-scope";
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

/** The three things that are typed rather than picked, held as a draft until
 * the whole profile is saved. */
interface TextDraft {
  name: string;
  bio: string;
  customStatus: string;
}

/** How long "Saved" stays up after a save. */
const SAVED_FLASH_MS = 1800;

/**
 * The one place a profile's typed edits are saved.
 *
 * The name, status and bio are edited on the card itself, and none of them has
 * a Save button: a bar rises from the bottom while anything is changed, says so,
 * and saves the lot in one go — the same bar the community overview uses for its
 * cards. Pictures, stickers and the rest apply as they are chosen, which is why
 * this is only about the three.
 */
function ProfileSaveBar({
  changes,
  saving,
  saved,
  error,
  onDiscard,
  onSave,
}: {
  changes: number;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const visible = changes > 0 || saved;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="profile-save-bar"
          role="status"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover/95 py-2 pr-2 pl-4 shadow-xl backdrop-blur-xl"
        >
          {changes === 0 ? (
            <span className="flex items-center gap-1.5 pr-2 text-sm">
              <Check className="size-4 text-emerald-500" />
              Profile saved
            </span>
          ) : (
            <>
              <span className="text-sm">
                {error ? (
                  <span className="text-destructive">{error}</span>
                ) : changes === 1 ? (
                  "1 change"
                ) : (
                  `${changes} changes`
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={saving}
                onClick={onDiscard}
              >
                Discard
              </Button>
              <Button size="sm" className="rounded-full" disabled={saving} onClick={onSave}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Save profile"}
              </Button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
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

  const [tab, setTab] = useState<"board" | "activity">("board");
  const [dialog, setDialog] = useState<
    | null
    | "images"
    | "decoration"
    | "nameStyle"
    | "theme"
    | "effect"
    | "stickers"
    | "css"
  >(null);
  /** Which picture the images dialog opens on. */
  const [imageKind, setImageKind] = useState<ProfileImageKind>("avatar");
  const openImages = (kind: ProfileImageKind) => {
    setImageKind(kind);
    setDialog("images");
  };

  // The typed edits, as only what has been changed: the card reads each field as
  // the edit if there is one and the stored value if not, so there is no copy of
  // the stored text to fall out of date, and "discard" is clearing this.
  const [edits, setEdits] = useState<Partial<TextDraft>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  if (!me || !values) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const text: TextDraft = {
    name: edits.name ?? values.name,
    bio: edits.bio ?? values.bio,
    customStatus: edits.customStatus ?? values.customStatus,
  };
  /** Only the fields whose edit differs from what is stored — typing something
   * and then typing it back is not a change. */
  const changed = (["name", "bio", "customStatus"] as const).filter(
    (key) => edits[key] !== undefined && edits[key] !== values[key],
  );

  const edit = (key: keyof TextDraft, value: string) => {
    setSaveError(null);
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const saveProfile = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await scope.saveText(text);
      setEdits({});
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  };

  /** Changing profile while there are unsaved edits would save them into the
   * wrong one or lose them, so it asks first. */
  const changeScope = (id: Id<"communities"> | undefined, name?: string) => {
    if (changed.length > 0 && !window.confirm("Discard your unsaved changes?")) return;
    setEdits({});
    setSaveError(null);
    setScopeId(id);
    setScopeName(name);
  };

  return (
    <div className={cn("relative flex h-full min-h-0 overflow-hidden bg-background", className)}>
      {/* ---------------------------------------------------------------- */}
      {/* Left rail — drawn in the unified sidebar, see `PageSidebar`        */}
      {/* ---------------------------------------------------------------- */}
      <PageSidebar>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
          <ScopeMenu
            communityId={scopeId}
            label={scopeId ? (scopeName ?? "Server Profile") : "Main Profile"}
            onChange={changeScope}
          />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-3 pb-6">
            <RailSection label="Nameplate">
              <RailTile
                onClick={() => openImages("nameplate")}
                label="Edit nameplate"
                filled={!!values.nameplateUrl}
                className="h-12"
              >
                <CosmeticMedia src={values.nameplateUrl} />
              </RailTile>
            </RailSection>

            <RailSection label="Avatar & Decoration">
              <div className="grid grid-cols-2 gap-2">
                <RailTile
                  onClick={() => openImages("avatar")}
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
                  onClick={() => openImages("banner")}
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

            <RailSection label="Profile Effect & Stickers" badge={<NewBadge />}>
              <div className="grid grid-cols-2 gap-2">
                <RailTile
                  onClick={() => setDialog("effect")}
                  label="Edit profile effect"
                  filled={!!values.profileEffect}
                >
                  <CosmeticMedia src={values.profileEffect} />
                </RailTile>
                <RailTile
                  onClick={() => setDialog("stickers")}
                  label="Edit profile stickers"
                  filled={!!values.profileFrame || (values.profileFrameLayers?.length ?? 0) > 0}
                >
                  <span className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Sticker className="size-6" />
                    <span className="text-[11px]">
                      {values.profileFrameLayers?.length ?? (values.profileFrame ? 1 : 0)} on your card
                    </span>
                  </span>
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

          </div>
        </ScrollArea>
      </div>
      </PageSidebar>

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
              // The name, status and bio are the card's own: click one to
              // change it. What is typed is a draft until the bar below saves.
              inlineEdit={{
                name: text.name,
                customStatus: text.customStatus,
                bio: text.bio,
                onNameChange: (value) => edit("name", value),
                onCustomStatusChange: (value) => edit("customStatus", value),
                onBioChange: (value) => edit("bio", value),
              }}
              member={{
                userId: me._id,
                name: text.name,
                username: me.username,
                imageUrl: values.imageUrl,
                bio: text.bio,
                customStatus: text.customStatus,
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
        onPickBanner={() => openImages("banner")}
      />
      <ProfileEffectDialog
        open={dialog === "effect"}
        onOpenChange={(o) => setDialog(o ? "effect" : null)}
        scope={scope}
      />
      <ProfileStickersDialog
        open={dialog === "stickers"}
        onOpenChange={(o) => setDialog(o ? "stickers" : null)}
        scope={scope}
        scopeId={scopeId}
        scopeName={scopeName}
      />
      <ProfileCssDialog
        open={dialog === "css"}
        onOpenChange={(o) => setDialog(o ? "css" : null)}
        scope={scope}
      />

      <ProfileImagesDialog
        open={dialog === "images"}
        onOpenChange={(o) => setDialog(o ? "images" : null)}
        scope={scope}
        scopeId={scopeId}
        initialKind={imageKind}
      />

      <ProfileSaveBar
        changes={changed.length}
        saving={saving}
        saved={saved}
        error={saveError}
        onDiscard={() => {
          setEdits({});
          setSaveError(null);
        }}
        onSave={() => void saveProfile()}
      />
    </div>
  );
}
