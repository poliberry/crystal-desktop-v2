"use client";

import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { Compass, Volume2 } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { Fragment, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCommunityActions } from "@/components/community/community-actions";
import { CreateCommunityDialog } from "@/components/community/create-community-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { useOutboxMutation } from "@/hooks/use-outbox-mutation";
import { parseInviteCode } from "@/lib/invites";
import { cn } from "@/lib/utils";
import { useNavigation } from "@/components/home/navigation-context";
import { SelectionPill } from "@/components/home/selection-pill";
import { USER_CARD_HEIGHT } from "./user-card";
import { useCall } from "../call/call-provider";

/** Pasting a whole invite link works the same as typing the bare code — see
 * `parseInviteCode`, which knows all the forms a link has had. Anything
 * unrecognised is passed through untouched so the join mutation reports it. */
function normalizeInviteInput(raw: string): string {
  return parseInviteCode(raw) ?? raw.trim();
}

/**
 * A tile in the rail that isn't a community — Home, and anything else that
 * ends up alongside it.
 *
 * Dressed exactly like a community tile, because it is one as far as the eye
 * is concerned: the same square that softens into a squircle on hover and
 * stays there while it is the thing you are looking at, and the same pill in
 * the gutter saying so. Two tiles in one column behaving differently is read
 * as one of them being broken.
 */
function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* `group` is what the pill's hover step reads; `relative` is what
              it positions against. */}
          <div className="group relative">
            <Button
              variant={active ? "default" : "secondary"}
              size="icon"
              className={cn(
                "size-12 rounded-none transition-[border-radius] ease-in-out hover:rounded-2xl",
                active && "rounded-2xl",
              )}
              onClick={onClick}
            >
              {children}
            </Button>
            <SelectionPill className="-left-2" state={active ? "active" : "idle"} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DiscoverDialog({
  onJoined,
}: {
  onJoined: (id: Id<"communities">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joiningByCode, setJoiningByCode] = useState(false);
  const discoverable =
    useQuery(api.communities.listDiscoverable, open ? {} : "skip") ?? [];
  const join = useMutation(api.communities.join);
  const joinByInviteCode = useMutation(api.communities.joinByInviteCode);

  const handleJoinByCode = async () => {
    const code = normalizeInviteInput(inviteInput);
    if (!code) return;
    setJoiningByCode(true);
    setInviteError(null);
    try {
      const communityId = await joinByInviteCode({ code });
      setOpen(false);
      setInviteInput("");
      onJoined(communityId);
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Couldn't join with that code.",
      );
    } finally {
      setJoiningByCode(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <RailButton label="Discover communities" onClick={() => setOpen(true)}>
        <Compass />
      </RailButton>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discover communities</DialogTitle>
          <DialogDescription>
            Open communities you can join right now. Invite-only servers need a
            link.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Enter an invite code"
            value={inviteInput}
            onChange={(e) => {
              setInviteInput(e.target.value);
              setInviteError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleJoinByCode();
            }}
          />
          <Button
            disabled={!inviteInput.trim() || joiningByCode}
            onClick={() => void handleJoinByCode()}
          >
            Join
          </Button>
        </div>
        {inviteError && (
          <p className="text-xs text-destructive">{inviteError}</p>
        )}

        <Separator />

        <ScrollArea className="h-72">
          <div className="flex flex-col gap-1 pr-3">
            {discoverable.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No open communities right now — join with an invite code above.
              </p>
            )}
            {discoverable.map((community) => (
              <div
                key={community.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60"
              >
                <Avatar size="sm">
                  <AvatarImage src={community.imageUrl} alt={community.name} />
                  <AvatarFallback>
                    {community.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {community.name}
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    void join({ communityId: community.id });
                    setOpen(false);
                    onJoined(community.id);
                  }}
                >
                  Join
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

interface CommunityActivity {
  memberCount: number;
  voice: { userId: Id<"users">; name: string; imageUrl?: string }[];
  voiceCount: number;
  unreadChannelIds: Id<"channels">[];
  mentionCount: number;
}

/**
 * Spring for the rail's add/remove, not a duration: a DM appearing is a
 * notification, and a spring's slight overshoot reads as something arriving
 * rather than something fading in. Damped hard enough that the tiles below
 * don't visibly wobble when one is removed.
 */
const RAIL_TRANSITION = { type: "spring" as const, stiffness: 500, damping: 34, mass: 0.7 };

/** Past this the badge outgrows the tile and the exact number stops mattering. */
const BADGE_CAP = 99;

function badgeText(count: number): string {
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/**
 * Unread DMs, as buttons under Home.
 *
 * Only conversations with something waiting appear here — the full list lives
 * in the DM sidebar. The rail's job is "there's something for you and here's
 * whose face it belongs to", which is why the avatar is the button rather
 * than a generic envelope with a number on it.
 */
function UnreadDirectMessages() {
  const nav = useNavigation();
  const conversations = useCachedQuery(api.conversations.listMine, {}, "conversations.listMine") ?? [];
  // Durable + coalescing, like the chat views (see src/lib/outbox.ts).
  const markRead = useOutboxMutation("markRead", "dm");
  const unread = conversations.filter((c: any) => c.unread);

  return (
    <AnimatePresence initial={false}>
      {unread.length > 0 && (
        <motion.div
          key="unread-dms"
          className="flex w-full flex-col items-center"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={RAIL_TRANSITION}
        >
          <AnimatePresence initial={false}>
            {unread.map((conversation: any) => {
              // A group's first member stands in for it, the same shorthand
              // the DM list uses; a one-to-one DM has exactly one other
              // person.
              const other = conversation.members[0];
              const name = conversation.name ?? other?.name ?? "Direct message";
              return (
                <motion.div
                  key={conversation.id}
                  // Height and margin collapse together so the tiles below
                  // close the gap as well as the tile itself, and the rail
                  // never shows a hole where a read DM used to be.
                  initial={{ opacity: 0, scale: 0.5, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, scale: 1, height: 48, marginBottom: 8 }}
                  exit={{ opacity: 0, scale: 0.5, height: 0, marginBottom: 0 }}
                  transition={RAIL_TRANSITION}
                >
                  <HoverCard openDelay={200} closeDelay={100}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div className="relative">
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              onClick={() => nav.openConversation(conversation.id)}
                              aria-label={`${name}, ${conversation.unreadCount} unread`}
                              className="flex size-12 items-center justify-center overflow-hidden rounded-none transition-all duration-200 ease-in-out group"
                            >
                              <Avatar className="size-12">
                                <AvatarImage src={conversation.imageUrl ?? other?.imageUrl} alt={name} className="rounded-none group-hover:rounded-2xl" />
                                <AvatarFallback className="text-sm">
                                  {name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            </button>
                          </HoverCardTrigger>
                          {conversation.unreadCount > 0 && (
                            <span className="pointer-events-none absolute -right-1 -bottom-1 flex h-5 min-w-5 items-center justify-center rounded-none bg-destructive px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
                              {badgeText(conversation.unreadCount)}
                            </span>
                          )}
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => void markRead({ conversationId: conversation.id })}>
                          Mark as read
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    <HoverCardContent side="right" align="start" className="w-fit max-w-md">
                      <p className="truncate text-sm font-semibold">{name}</p>
                    </HoverCardContent>
                  </HoverCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
          <Separator className="max-w-8 mx-2" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * What a server's rail tile shows on hover: its name, how big it is, and
 * who's in voice right now.
 *
 * A hover card rather than a tooltip because of the voice row — a stack of
 * faces answers "is anyone I know in there" at a glance in a way a count
 * doesn't, and tooltip styling (small, dense, built for one line) fights
 * that.
 */
function CommunityCardBody({
  name,
  activity,
}: {
  name: string;
  activity: CommunityActivity | undefined;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="truncate text-sm font-semibold">{name}</p>
        {activity && (
          <p className="text-xs text-muted-foreground">
            {activity.memberCount} {activity.memberCount === 1 ? "member" : "members"}
          </p>
        )}
      </div>

      {!!activity?.voiceCount && (
        <div className="space-y-1.5 border-t border-border/50 pt-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
            <Volume2 className="size-3.5" />
            {activity.voiceCount} in voice
          </p>
          <AvatarGroup data-size="sm">
            {activity.voice.map((participant) => (
              <Avatar key={participant.userId} size="sm" title={participant.name}>
                <AvatarImage src={participant.imageUrl} alt={participant.name} />
                <AvatarFallback className="text-[8px]">
                  {participant.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {activity.voiceCount > activity.voice.length && (
              <AvatarGroupCount className="text-[10px]">
                +{activity.voiceCount - activity.voice.length}
              </AvatarGroupCount>
            )}
          </AvatarGroup>
        </div>
      )}
    </div>
  );
}

/**
 * One server in the rail: its tile, its hover card, and its right-click menu.
 *
 * Its own component rather than markup inside the rail's `map` so each tile can
 * hold the dialogs its menu opens — and, only once that menu has actually been
 * opened, a permissions subscription. Hooks can't be called from a loop.
 */
function CommunityTile({
  community,
  activity,
  selected,
  alreadyOpen,
  canOpenInCurrentTab,
  onSelectCommunity,
}: {
  community: {
    id: Id<"communities">;
    name: string;
    imageUrl?: string;
    isOwner: boolean;
  };
  activity: CommunityActivity | undefined;
  selected: boolean;
  /** Whether this community already has a tab open — see `openCommunityIds`. */
  alreadyOpen: boolean;
  canOpenInCurrentTab: boolean;
  onSelectCommunity: (id: Id<"communities">, mode?: "replace" | "new") => void;
}) {
  const [menuOpened, setMenuOpened] = useState(false);
  const { items, dialogs } = useCommunityActions({
    communityId: community.id,
    isOwner: community.isOwner,
    enabled: menuOpened,
  });

  const inVoice = !!activity?.voiceCount;
  const mentions = activity?.mentionCount ?? 0;
  const hasUnread = (activity?.unreadChannelIds.length ?? 0) > 0;

  return (
    <>
      <HoverCard openDelay={200} closeDelay={100}>
        <ContextMenu onOpenChange={(open) => open && setMenuOpened(true)}>
          <ContextMenuTrigger asChild>
            {/* The badge sits outside the button because the button clips its
                contents — that's what gives the tile its square-to-squircle
                morph on hover. `group` is for the pill's hover step. */}
            <div className="group relative">
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  aria-label={[
                    community.name,
                    inVoice ? "call in progress" : null,
                    mentions > 0 ? ` mentions` : hasUnread ? "unread messages" : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  onClick={(e) =>
                    onSelectCommunity(community.id, e.shiftKey ? "new" : "replace")
                  }
                  className={cn(
                    "flex size-12 items-center justify-center overflow-hidden rounded-full bg-secondary transition-[border-radius] ease-in-out hover:rounded-2xl",
                    // The pill says which tile is open now, so the selected
                    // tile just holds the squircle hover settles on rather
                    // than wearing a ring saying the same thing twice.
                    selected && "rounded-2xl",
                  )}
                >
                  <Avatar className="size-12 rounded-none">
                    <AvatarImage
                      src={community.imageUrl}
                      alt={community.name}
                      className="rounded-none"
                    />
                    <AvatarFallback className="rounded-none text-sm">
                      {community.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </HoverCardTrigger>
              {inVoice && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center bg-emerald-500 text-white ring-2 ring-primary"
                >
                  <Volume2 className="size-3" />
                </span>
              )}
              {/* Mentions still get a number — "someone said your name" is a
                  different claim from "something was said", and the pill on
                  the left already carries the latter. A busy server would
                  otherwise wear a permanent count meaning nothing much. */}
              {mentions > 0 && (
                <span className="pointer-events-none absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
                  {badgeText(mentions)}
                </span>
              )}
              {/* Hangs off the tile into the rail's left gutter, where it
                  lines up with every other tile's pill. */}
              <SelectionPill
                className="-left-2"
                state={selected ? "active" : hasUnread || mentions > 0 ? "unread" : "idle"}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {canOpenInCurrentTab && !alreadyOpen && (
              <ContextMenuItem
                onClick={() => onSelectCommunity(community.id, "replace")}
              >
                Open in current tab
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => onSelectCommunity(community.id, "new")}>
              {alreadyOpen ? "Open tab" : "Open in new tab"}
            </ContextMenuItem>
            {/* The same actions the sidebar's header dropdown offers, so a
                server can be invited to, added to or configured without
                opening it first. Empty for a plain member of a server that
                grants them nothing. */}
            {items.length > 0 && <ContextMenuSeparator />}
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Fragment key={item.key}>
                  {item.separatorBefore && <ContextMenuSeparator />}
                  <ContextMenuItem
                    variant={item.destructive ? "destructive" : "default"}
                    onClick={item.onSelect}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </ContextMenuItem>
                </Fragment>
              );
            })}
          </ContextMenuContent>
        </ContextMenu>
        <HoverCardContent side="right" align="start" className="w-60">
          <CommunityCardBody name={community.name} activity={activity} />
        </HoverCardContent>
      </HoverCard>
      {/* Outside the menu: its content unmounts when it closes, and these have
          to outlive that to still be on screen. */}
      {dialogs}
    </>
  );
}

interface CommunityRailProps {
  selectedCommunityId: Id<"communities"> | null;
  onSelectHome: () => void;
  /** Default click replaces the active tab (mode omitted/"replace"); shift-
   * click or the right-click menu can request "new" to open alongside it
   * instead. */
  onSelectCommunity: (id: Id<"communities">, mode?: "replace" | "new") => void;
  /** Whether replacing the active tab is actually possible. False when the
   * active tab is pinned (pinned tabs are never silently swapped out, so
   * "replace" would quietly open a new tab instead) — the right-click menu
   * hides that option rather than offering a misleading one. */
  canOpenInCurrentTab: boolean;
  /** Communities that already have a channel tab open. Opening one of these
   * just focuses that existing tab (tab ids derive from their target, so the
   * same channel can't be open twice) — so the menu collapses to a single
   * "Open tab" item rather than two entries that would do the same thing. */
  openCommunityIds: Set<Id<"communities">>;
}

export function CommunityRail({
  selectedCommunityId,
  onSelectHome,
  onSelectCommunity,
  canOpenInCurrentTab,
  openCommunityIds,
}: CommunityRailProps) {
  const {
    activeCall,
    controller,
    expand,
    leaveCall,
    sharedSourceName,
    openSharePicker,
  } = useCall();
  const {
    cameraEnabled,
    microphoneEnabled,
    screenSharing,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
  } = controller;
  const communities = useCachedQuery(api.communities.listMine, {}, "communities.listMine") ?? [];
  const activityByCommunity = new Map(
    (useQuery(api.communities.listMineActivity) ?? []).map((entry) => [
      entry.communityId as string,
      entry,
    ])
  );

  return (
    <div className={cn(
      `flex w-16 shrink-0 flex-col items-center gap-2 bg-background/60 backdrop-blur-xl py-3`,
      activeCall && screenSharing ? `pb-60` : activeCall ? `pb-50` : `pb-20`
    )}>
      <RailButton
        label="Direct messages"
        active={!selectedCommunityId}
        onClick={onSelectHome}
      >
        {/* The app's own mark rather than a house: this tile is Crystal,
            not a home page, and it is the one tile in the rail that isn't
            somebody's picture. */}
        <LogoMark className="size-6" />
      </RailButton>

      <Separator className="max-w-8 mx-2" />

      <UnreadDirectMessages />

      <ScrollArea className="min-h-0 flex-1 w-full">
        {/* px-2 leaves the gutter the selection pills hang into, and py-1
            keeps the first and last tile's badges off the edge of the
            ScrollArea's overflow-hidden viewport. */}
        <div className="flex flex-col items-center gap-2 px-2 py-1">
          {communities.map((community: any) => (
            <CommunityTile
              key={community.id}
              community={community}
              activity={activityByCommunity.get(community.id)}
              selected={selectedCommunityId === community.id}
              alreadyOpen={openCommunityIds.has(community.id)}
              canOpenInCurrentTab={canOpenInCurrentTab}
              onSelectCommunity={onSelectCommunity}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="flex flex-col items-center gap-2 px-2">
        {/* Wrapped rather than given a prop: the pill needs a positioned,
            hoverable box around the trigger, and that box is the dialog's
            neighbour rather than its business. */}
        <div className="group relative">
          <CreateCommunityDialog onCreated={onSelectCommunity} />
          <SelectionPill className="-left-2" state="idle" />
        </div>
      </div>
    </div>
  );
}
