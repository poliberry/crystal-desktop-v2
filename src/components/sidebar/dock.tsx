"use client";

import { useQuery } from "convex/react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
} from "framer-motion";
import {
  MonitorCog,
  MonitorUp,
  Phone,
  ScreenShareOff,
  Video,
  VideoOff,
} from "lucide-react";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { AudioDeviceWheels } from "@/components/audio-device-wheels";
import { useAudioPreferences } from "@/components/audio-provider";
import {
  ParticipantChip,
  sortByActivity,
  useCallRoster,
} from "@/components/call/call-participant-strip";
import { useCall } from "@/components/call/call-provider";
import {
  ConnectionPanel,
  GRADE,
} from "@/components/call/connection-details";
import { SoundboardButton } from "@/components/call/soundboard";
import { useCallTitle } from "@/components/call/use-call-title";
import { useCallStats, type ConnectionGrade } from "@/hooks/use-call-stats";
import { MemberProfileCard } from "@/components/community/member-profile-card";
import { Nameplate } from "@/components/profile/nameplate";
import { ProfilePopoverContent } from "@/components/profile/profile-popover";
import { PresenceBadge } from "@/components/presence-dot";
import {
  presenceHeadline,
  RichPresenceCard,
  topActivity,
} from "@/components/rich-presence-card";
import { useOpenSettings } from "@/components/pages/page-context";
import { GLASS_BASE, GLASS_CONTROL, GLASS_DARK, GLASS_NEUTRAL } from "@/components/sidebar/glass";
import { StatusDialog } from "@/components/status-dialog";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMediaDeviceAvailability } from "@/hooks/use-media-devices";
import { useMyPresence } from "@/hooks/use-presence";
import { ownDecorationState } from "@/lib/avatar-decorations";
import { STATUS_LABEL, type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type { RichPresenceActivity } from "@/types/desktop-api";
import {
  ChevronUpIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  SettingsIcon,
} from "@animateicons/react/lucide";

/**
 * Lets something inside a card keep the pile spread while it is open.
 *
 * A modal menu or dialog blocks pointer events on everything behind it, the
 * dock included — so the browser reports the pointer as having left the stack
 * the moment it opens, the list folds up, and the card that owns the menu goes
 * with it. Anything that opens one reports it here and the pile holds still
 * until it closes.
 */
const DockPinContext = createContext<(delta: number) => void>(() => {});

function usePinDockWhile(open: boolean) {
  const pin = useContext(DockPinContext);
  useEffect(() => {
    if (!open) return;
    pin(1);
    return () => pin(-1);
  }, [open, pin]);
}

/** Controls on a glass card: a faint fill instead of the opaque `secondary`. */
const GLASS_BUTTON = GLASS_CONTROL;

// --- The cards that stack above the user ------------------------------------

/** The label and colour for the call's connection, in the words the card uses. */
function callStatus(
  status: string,
  grade: ConnectionGrade,
): { label: string; tone: string } {
  if (status === "connected") return { label: "Connected", tone: GRADE[grade].tone };
  if (status === "error" || status === "disconnected") {
    return { label: "Unable to connect", tone: "text-red-500" };
  }
  return { label: "Connecting...", tone: "text-amber-400" };
}

/** One small control on the call card. */
function CallButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "size-7 shrink-0 rounded-md",
            GLASS_BUTTON,
            destructive && "text-red-400 hover:bg-destructive/30 hover:text-red-300",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The call you're in, kept small.
 *
 * Folded, it is a line saying how the call is going and where, and under it the
 * two people who have spoken most recently with a count of everyone else.
 * `spread` is the same card when the pile is open: the avatars become a
 * scrolling row of everyone, and the call's controls sit beside them. The row
 * is the same height either way, so opening the pile doesn't resize the card.
 */
function CallCard({ spread }: { spread: boolean }) {
  const {
    activeCall,
    controller,
    expand,
    leaveCall,
    openSharePicker,
  } = useCall();
  const { hasCamera } = useMediaDeviceAvailability();
  const title = useCallTitle(activeCall);
  const { participants, metaByIdentity, soundboardActive } = useCallRoster();
  const { status, room, cameraEnabled, screenSharing, toggleCamera, toggleScreenShare } =
    controller;
  const stats = useCallStats(room, status === "connected");
  const [statsOpen, setStatsOpen] = useState(false);
  usePinDockWhile(statsOpen);

  const { label, tone } = callStatus(status, stats.grade);
  const ordered = sortByActivity(participants);
  const shown = ordered.slice(0, 2);
  const hidden = ordered.length - shown.length;

  const chip = (p: (typeof participants)[number], className?: string) => (
    <ParticipantChip
      key={p.identity}
      participant={p}
      soundboardActive={soundboardActive.has(p.identity)}
      meta={metaByIdentity.get(p.identity) ?? {}}
      className={className}
    />
  );

  return (
    <div className={cn(GLASS_BASE, GLASS_DARK, "px-3.5 py-3")}>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        {/* The status opens the connection panel; the name goes back to the
            call. Two targets on one line rather than one target that does
            both, because "how is it going" and "take me there" are different
            questions. */}
        <Popover open={statsOpen} onOpenChange={setStatsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Connection details"
              className={cn("shrink-0 font-semibold hover:underline", tone)}
            >
              {label}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 p-3">
            <ConnectionPanel stats={stats} />
          </PopoverContent>
        </Popover>
        <span aria-hidden className="shrink-0 text-muted-foreground">
          •
        </span>
        <button
          type="button"
          onClick={expand}
          className="min-w-0 flex-1 truncate text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          {title}
        </button>
      </div>

      <TooltipProvider>
        <div className="mt-2 flex min-w-0 items-center gap-3">
          {spread ? (
            <div
              // Sideways with the wheel: a row of avatars that only scrolls
              // with a trackpad is a row you can't reach with a mouse. The
              // padding is room for the ring and the mute badge, which
              // `overflow-x` would otherwise clip.
              onWheel={(e) => {
                if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY;
              }}
              className="-my-1 flex min-w-0 flex-1 items-center overflow-x-auto px-0.5 py-1 [scrollbar-width:none]"
            >
              {/* The same avatars as the folded stack, starting exactly where
                  it has them — the first two overlapped, the rest tucked away
                  — and easing apart. Opening the pile is the stack coming
                  open, not the stack being swapped for a row. */}
              {ordered.map((p, index) => {
                const folded = { marginLeft: index === 0 ? 0 : -8, opacity: index < 2 ? 1 : 0 };
                return (
                  <Fragment key={p.identity}>
                    <motion.div
                      className="shrink-0"
                      initial={folded}
                      animate={{ marginLeft: index === 0 ? 0 : 6, opacity: 1 }}
                      exit={folded}
                      transition={SPREAD_TRANSITION}
                    >
                      {chip(p, "ring-2 ring-[color:var(--glass-ring)] rounded-md")}
                    </motion.div>
                    {/* The count sits where it does in the folded stack, then
                        folds away as the people it stood for appear. */}
                    {index === 1 && hidden > 0 && (
                      <motion.span
                        className="shrink-0 overflow-hidden whitespace-nowrap rounded-full border border-foreground/15 bg-foreground/10 text-[10px] font-semibold text-muted-foreground"
                        initial={{ width: "auto", marginLeft: 6, paddingInline: 6, borderWidth: 1, opacity: 1 }}
                        animate={{ width: 0, marginLeft: 0, paddingInline: 0, borderWidth: 0, opacity: 0 }}
                        exit={{ width: "auto", marginLeft: 6, paddingInline: 6, borderWidth: 1, opacity: 1 }}
                        transition={SPREAD_TRANSITION}
                      >
                        +{hidden}
                      </motion.span>
                    )}
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <div className="-my-1 flex min-w-0 flex-1 items-center py-1 pl-0.5">
              <div className="flex items-center -space-x-2">
                {shown.map((p) => chip(p, "ring-2 ring-[color:var(--glass-ring)] rounded-md"))}
              </div>
              {hidden > 0 && (
                <span className="ml-1.5 rounded-full border border-foreground/15 bg-foreground/10 px-1.5 text-[10px] font-semibold text-muted-foreground">
                  +{hidden}
                </span>
              )}
            </div>
          )}

          {spread && (
            // Slides in from the right and out again — these only exist in the
            // spread card, so without this they would appear and vanish the
            // instant the pile opens or closes.
            <motion.div
              className="flex shrink-0 items-center gap-1.5"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ ...SPREAD_TRANSITION, delay: 0.05 }}
            >
              {/* Same trigger as the full call screen's control bar; the
                  className overrides its round 40px shape for this row. */}
              <SoundboardButton
                variant="ghost"
                className={cn("size-7 rounded-md", GLASS_BUTTON)}
              />
              <CallButton
                label={screenSharing ? "Stop sharing" : "Share screen"}
                onClick={() => {
                  if (screenSharing) void toggleScreenShare();
                  else openSharePicker();
                }}
              >
                {screenSharing ? (
                  <ScreenShareOff className="size-4" />
                ) : (
                  <MonitorUp className="size-4" />
                )}
              </CallButton>
              <CallButton
                label={!hasCamera ? "No camera" : cameraEnabled ? "Camera off" : "Camera on"}
                disabled={!hasCamera}
                onClick={() => void toggleCamera()}
              >
                {cameraEnabled ? (
                  <Video className="size-4" />
                ) : (
                  <VideoOff className="size-4 text-destructive" />
                )}
              </CallButton>
              <CallButton label="Leave call" destructive onClick={() => void leaveCall()}>
                <Phone className="size-4 rotate-135" />
              </CallButton>
            </motion.div>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

/** What you're sharing, with the two things you'd want to do about it. */
function ShareCard() {
  const { controller, sharedSourceName, openShareSettings } = useCall();

  return (
    <div className={cn(GLASS_BASE, GLASS_NEUTRAL, "flex items-center gap-2 px-3 py-2 text-sm")}>
      <MonitorUp className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate font-medium">
        Sharing{sharedSourceName ? `: ${sharedSourceName}` : ""}
      </span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:bg-foreground/10"
              onClick={openShareSettings}
            >
              <MonitorCog className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Change screen, audio or quality</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-destructive hover:bg-destructive/20"
              onClick={() => void controller.toggleScreenShare()}
            >
              <ScreenShareOff className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Stop sharing</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

/** One of your own Rich Presence activities — what you're playing or hearing. */
function ActivityCard({ activity }: { activity: RichPresenceActivity }) {
  return (
    <div className={cn(GLASS_BASE, GLASS_NEUTRAL)}>
      <RichPresenceCard
        activity={activity}
        className="rounded-none border-0 bg-transparent"
      />
    </div>
  );
}

// --- The user card -----------------------------------------------------------

/**
 * You: avatar and profile popover, name and status, and the controls that apply
 * whether or not a call is running — mute, deafen, audio devices, settings.
 */
function IdentityCard({ underlap, inset }: { underlap: number; inset: boolean }) {
  const me = useQuery(api.users.getCurrentUser);
  const { status, activities } = useMyPresence();
  const { activeCall, controller, sharedSourceName } = useCall();
  const { muted, deafened, toggleMuted, toggleDeafened } = useAudioPreferences();
  const [statusOpen, setStatusOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  usePinDockWhile(statusOpen || devicesOpen || profileOpen);
  const cardRef = useRef<HTMLDivElement>(null);

  // How far down the nameplate has dissolved, as a percentage of the row. At 0
  // the mask is solid, so the nameplate is exactly as it is at rest; opened, its
  // top edge melts into the gradient above it. A number driving a template
  // rather than a swapped class because a mask's gradient can't be transitioned
  // but the stop it is built from can.
  const plateFade = useMotionValue(0);
  const plateMask = useMotionTemplate`linear-gradient(to bottom, transparent 0%, black ${plateFade}%)`;
  useEffect(() => {
    const controls = animate(plateFade, devicesOpen ? 80 : 0, { duration: 0.3 });
    return () => controls.stop();
  }, [devicesOpen, plateFade]);

  // The pickers are part of the card rather than a menu over it, so nothing
  // dismisses them for us: a press anywhere outside the card, or Escape, does.
  useEffect(() => {
    if (!devicesOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setDevicesOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDevicesOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [devicesOpen]);
  const openSettings = useOpenSettings();
  const { hasMicrophone } = useMediaDeviceAvailability();
  // Resolved here rather than by a query: this card reads the raw user
  // document, so the birthday-overrides-your-choice rule has to be applied
  // locally — see ownDecorationState.
  const { decoration, isBirthday } = ownDecorationState(me);

  if (!me) return null;

  // Fold a live screen share into the activities the presence dot reads, so
  // your own avatar shows the streaming glyph — the same thing every other
  // card does for you through `useUserActivities` / `presence.streamOf`, which
  // this card's raw presence read doesn't go through.
  const badgeActivities: RichPresenceActivity[] =
    activeCall && controller.screenSharing
      ? [{ type: "streaming", name: sharedSourceName || "your screen" }, ...activities]
      : activities;

  // Your own card reads the raw profile, so the deadline has to be applied
  // here — everyone else sees it through a query that already has.
  const customStatus =
    me.customStatusExpiresAt && me.customStatusExpiresAt <= Date.now()
      ? undefined
      : me.customStatus;

  // What you are doing and what you say you are doing, on one line. A call
  // outranks the plain status label but not either of those.
  const subtitle =
    presenceHeadline(customStatus, topActivity(activities)) ??
    (activeCall ? "In voice" : STATUS_LABEL[status]);

  return (
    // `underlap` is how far the card above sits down over this one. The frame
    // grows by that much and pads its contents down by the same, so the
    // avatar and controls stay clear of whatever is lying on top of it.
    // `inset` narrows it while it is a card in the pile, so it reads as the one
    // underneath: the card on top is the full width, this peeks out below it.
    //
    // When the spread list wraps this in a `folded` / `open` variant parent
    // (see `SidebarDock`), the frame and body follow it: the card starts the
    // way the folded pile has it, with its top edge hidden under the card
    // above, grows out from under it as the list opens, and goes back under it
    // as the list closes. Without a parent it just sits at the static values.
    //
    // The surface is on this wrapper rather than on the frame so the device
    // pickers can unfold above the row and the card grows around them.
    <div
      ref={cardRef}
      // `rounded-lg`, the sidebar's own radius, rather than the glass family's
      // 2xl: the card sits a few px inside the sidebar's corner, and a rounder
      // curve than the one around it leaves a wedge of gap there.
      className={cn(GLASS_BASE, GLASS_NEUTRAL, "rounded-lg")}
      style={{ marginInline: inset ? 10 : 0 }}
    >
      {/* The call card's surface, faded in over this one while the pickers are
          open — a second layer rather than swapped classes, because a
          background-image can't be transitioned and the card would blink. */}
      <motion.div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0", GLASS_DARK)}
        initial={false}
        animate={{ opacity: devicesOpen ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />

      <AnimatePresence initial={false}>
        {devicesOpen && (
          <motion.div
            key="devices"
            className="relative overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPREAD_TRANSITION}
          >
            <AudioDeviceWheels />
          </motion.div>
        )}
      </AnimatePresence>

    <motion.div
      style={{ height: 56 + underlap }}
      variants={IDENTITY_FRAME}
      transition={SPREAD_TRANSITION}
    >
      <motion.div
        className="relative flex h-full items-center gap-2 px-3"
        style={{ paddingTop: underlap }}
        variants={IDENTITY_BODY}
        transition={SPREAD_TRANSITION}
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ maskImage: plateMask, WebkitMaskImage: plateMask }}
        >
          <Nameplate url={me.nameplateUrl} />
        </motion.div>

        <Popover open={profileOpen} onOpenChange={setProfileOpen}>
          <PopoverTrigger asChild>
            <Avatar size="default" className="relative shrink-0 cursor-pointer">
              <AvatarImage src={me.imageUrl} alt={me.name} className="rounded-md" />
              <AvatarFallback>{me.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              <AvatarDecoration value={decoration} />
              <PresenceBadge
                status={status}
                activities={badgeActivities}
                accent={me.borderGradientStart}
                isBirthday={isBirthday}
              />
            </Avatar>
          </PopoverTrigger>
          {/* The same transparent host every other profile card gets: the card
              brings its own surface and its frame is drawn outside its edges,
              so a popover panel behind it shows up as a second box sticking
              out from under the artwork. */}
          <ProfilePopoverContent
            userId={me._id}
            side="top"
            align="start"
            className="mb-5 -ml-4"
          >
            <MemberProfileCard
              reserveFrameRoom={false}
              member={{
                userId: me._id,
                name: me.name,
                username: me.username,
                imageUrl: me.imageUrl,
                bio: me.bio,
                customStatus,
                bannerUrl: me.bannerUrl,
                avatarDecoration: decoration,
                isBirthday,
                borderGradientStart: me.borderGradientStart,
                borderGradientEnd: me.borderGradientEnd,
                // "invisible" appears as offline to others; show the same for self
                status: (status === "invisible" ? "offline" : status) as FriendStatus,
              }}
            />
          </ProfilePopoverContent>
        </Popover>

        {/* The name is the second way into the status dialog — the first (the
            pill on your profile card) only exists once you already have a
            custom status set. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setStatusOpen(true)}
                className="group/name min-w-0 flex-1 cursor-pointer rounded-md px-1 py-0.5 text-left hover:bg-foreground/10"
              >
                <p className="truncate text-sm font-semibold">{me.name}</p>
                <div className="relative h-4 overflow-hidden">
                  <p className="absolute inset-0 flex items-center gap-1 truncate text-xs text-muted-foreground transition-all duration-200 group-hover/name:translate-y-full group-hover/name:opacity-0">
                    <span className="truncate">{subtitle}</span>
                  </p>
                  <p className="absolute inset-0 -translate-y-full truncate text-xs text-muted-foreground opacity-0 transition-all duration-200 group-hover/name:translate-y-0 group-hover/name:opacity-100">
                    @{me.username}
                  </p>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Set your status</TooltipContent>
          </Tooltip>

          <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />

          <div className="flex shrink-0 items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 shrink-0 hover:bg-foreground/10",
                    muted && "text-destructive hover:bg-destructive/20",
                  )}
                  disabled={!hasMicrophone}
                  onClick={toggleMuted}
                >
                  {muted ? (
                    <MicOffIcon duration={0.8} className="size-4" />
                  ) : (
                    <MicIcon duration={0.8} className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {!hasMicrophone ? "No microphone detected" : muted ? "Unmute" : "Mute"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-7 shrink-0 hover:bg-foreground/10",
                    deafened && "text-destructive hover:bg-destructive/20",
                  )}
                  onClick={toggleDeafened}
                >
                  {deafened ? (
                    <HeadphoneOffIcon duration={0.8} className="size-4" />
                  ) : (
                    <HeadphonesIcon duration={0.8} className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{deafened ? "Undeafen" : "Deafen"}</TooltipContent>
            </Tooltip>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Audio devices"
              aria-expanded={devicesOpen}
              className="size-7 shrink-0 hover:bg-foreground/10"
              onClick={() => setDevicesOpen((open) => !open)}
            >
              <ChevronUpIcon
                duration={0.8}
                className={cn("size-4 transition-transform duration-300", devicesOpen && "rotate-180")}
              />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 hover:bg-foreground/10"
              onClick={() => openSettings()}
            >
              <SettingsIcon duration={0.8} className="size-4" />
            </Button>
          </div>
        </TooltipProvider>
      </motion.div>
    </motion.div>
    </div>
  );
}

// --- The stack ---------------------------------------------------------------

/** How far the front card lies over the top of the user card, in px. The
 * cards are a pile, not a column: the one in front covers the edge of the one
 * behind it. */
const OVERLAP = 22;

/** Vertical offset per card behind the front one, in px. */
const STACK_PEEK = 6;

/** However many cards there are, only this many sheets peek out above the
 * front one — past that the edges are too thin to read as anything but noise. */
const MAX_STACK_SHEETS = 2;

const SPREAD_TRANSITION = { type: "spring" as const, stiffness: 420, damping: 34 };

/** The user card as the folded pile has it (its top hidden under the card above)
 * and as the list has it. */
const IDENTITY_FRAME = {
  folded: { height: 56 + OVERLAP },
  open: { height: 56 },
};
const IDENTITY_BODY = {
  folded: { paddingTop: OVERLAP },
  open: { paddingTop: 0 },
};

/**
 * One card in the spread list. `depth` is how many cards sit between it and
 * the user card; the deeper it is, the further back and lower it starts, and
 * the later it moves, so the pile reads as fanning out rather than appearing.
 */
function SpreadCard({
  depth,
  children,
}: {
  depth: number;
  children: React.ReactNode;
}) {
  // The front card is the one that was already on screen: it starts exactly
  // where the folded pile drew it (8px lower than its place in the list) and
  // stays opaque, so the swap between the two is invisible. Only the cards
  // that were hidden behind it fade in.
  const folded = {
    opacity: depth === 0 ? 1 : 0,
    // 8px for the gap the list has and the pile doesn't, and the 22px the user
    // card below is taller by while it is folded (it hasn't grown out from
    // under this card yet, so everything above it sits that much higher).
    y: 8 + OVERLAP + depth * 14,
    scale: 1 - depth * 0.04,
  };
  return (
    <motion.div
      initial={folded}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={folded}
      transition={{ ...SPREAD_TRANSITION, delay: depth * 0.03 }}
      // Above the user card, which is under this one while the list opens and
      // closes.
      style={{ transformOrigin: "bottom", position: "relative", zIndex: depth === 0 ? 10 : 1 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The bottom of the sidebar: a pile of cards — whatever is going on (the call
 * you're in, a screen share, what you're playing) on top, and your user card
 * at the bottom of it.
 *
 * Folded, it looks like a pile: the front card is the full width, the user
 * card sits under it a little narrower, and any further cards lean back behind
 * the front one. Pointing anywhere on it spreads the whole pile into a list,
 * user card last, and tells the sidebar (via `onExpandedChange`) to blur
 * everything else so the list is the only thing in focus. The front card and
 * the user card never remount, so a button under the pointer stays under it.
 */
export function SidebarDock({
  onExpandedChange,
}: {
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { activeCall, controller } = useCall();
  const { activities } = useMyPresence();
  const [hovered, setHovered] = useState(false);
  const [pins, setPins] = useState(0);
  const pin = useCallback((delta: number) => setPins((n) => n + delta), []);

  // Whatever was holding the pile open is gone, so forget the hover too. The
  // dialog or menu is drawn in a portal, which React counts as part of this
  // element: the pointer moved over it, never "left" the dock, and then it
  // vanished — so no leave event arrives to clear the hover, and the pile would
  // sit spread until the pointer happened to cross its edge. If the pointer is
  // in fact still over the dock, its next movement opens the pile again.
  const wasPinned = useRef(false);
  useEffect(() => {
    if (pins > 0) {
      wasPinned.current = true;
    } else if (wasPinned.current) {
      wasPinned.current = false;
      setHovered(false);
    }
  }, [pins]);

  // Front first: the call is the thing most likely to be touched, and it sits
  // against the user card where the mute and deafen buttons already are.
  // Each card is a function of whether the pile is spread, because the call
  // card shows more when it is.
  const cards: { key: string; render: (spread: boolean) => React.ReactNode }[] = [];
  if (activeCall) cards.push({ key: "call", render: (spread) => <CallCard spread={spread} /> });
  if (activeCall && controller.screenSharing) {
    cards.push({ key: "share", render: () => <ShareCard /> });
  }
  activities.forEach((activity, index) => {
    cards.push({
      key: `activity-${activity.type}-${activity.name}-${index}`,
      render: () => <ActivityCard activity={activity} />,
    });
  });

  const [front, ...rest] = cards;
  // The user card is always in the pile, so one card above it is already a
  // stack worth spreading.
  const piled = !!front;
  const expanded = (hovered || pins > 0) && piled;
  const sheets = Math.min(rest.length, MAX_STACK_SHEETS);

  // The folded pile stays hidden from the moment the list opens until the list
  // has finished leaving, not just while the pointer is over it. Showing it
  // again on mouseleave would put it under the list's cards while they are
  // still sliding back — two copies of the call card at once.
  const [spread, setSpread] = useState(false);
  if (expanded && !spread) setSpread(true);

  // A card that goes away under the pointer takes its mouseleave with it, so
  // the hover would otherwise be remembered and the next card to arrive would
  // open the stack on its own.
  useEffect(() => {
    if (!piled) setHovered(false);
  }, [piled]);

  useEffect(() => {
    onExpandedChange(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <DockPinContext.Provider value={pin}>
    <div
      className="relative flex flex-col p-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* The folded pile. Its size and position never change — the dock is
          anchored to the bottom, so anything here that moved on hover would
          move the user card under the pointer, which moves the hover area,
          which un-hovers it. While the pile is spread it is hidden rather than
          removed, so it keeps holding its place. */}
      <div className={cn("flex flex-col", (expanded || spread) && "invisible")}>
        {front && (
          <div
            className="relative z-10"
            // The room the sheets lean back into, and how far this card lies
            // over the user card. Padding rather than margin on top, because a
            // child's top margin would collapse through this box.
            style={{ paddingTop: STACK_PEEK * sheets, marginBottom: -OVERLAP }}
          >
            <div className="relative">
              {Array.from({ length: sheets }, (_, index) => {
                const depth = sheets - index;
                return (
                  <div
                    key={depth}
                    aria-hidden
                    // `visible` overrides the hidden pile around it: these are
                    // what the cards in the list fold back into, so they have
                    // to be there as the list leaves, not after it has gone.
                    className={cn(
                      GLASS_BASE,
                      GLASS_NEUTRAL,
                      "visible absolute inset-0 origin-bottom transition-opacity duration-200",
                    )}
                    style={{
                      transform: `translateY(${-depth * STACK_PEEK}px) scaleX(${1 - depth * 0.05})`,
                      opacity: expanded ? 0 : 1 - depth * 0.25,
                    }}
                  />
                );
              })}
              <div className="relative z-10">{front.render(false)}</div>
              {rest.length > 0 && (
                <span
                  // Unlike the sheets, this has no business being visible while
                  // the list is on its way out: the list's cards pass over it
                  // and it reads as clipping behind them. Gone instantly when
                  // the list opens (no transition into the hidden state), back
                  // with a fade once the list has left.
                  className={cn(
                    "pointer-events-none absolute top-0 right-4 z-20 -translate-y-1/2 rounded-full border border-white/15 bg-black/60 px-1.5 text-[10px] font-semibold text-muted-foreground",
                    expanded || spread
                      ? "opacity-0 transition-none"
                      : "opacity-100 transition-opacity duration-200",
                  )}
                >
                  +{rest.length}
                </span>
              )}
            </div>
          </div>
        )}

        <IdentityCard underlap={piled ? OVERLAP : 0} inset={piled} />
      </div>

      {/* The spread pile: every card in a list, the user card last. Laid over
          the folded one from the same bottom edge, so the user card ends up
          where it already was. Fades in rather than sliding, for the same
          reason. */}
      {/* No fade or scroll container around the list itself: glass blurs what
          is behind it, and an ancestor that is fading (or clipping) breaks that
          while it happens. The cards animate individually instead. */}
      <AnimatePresence onExitComplete={() => setSpread(false)}>
        {expanded && front && (
          <motion.div
            key="list"
            className="absolute inset-x-2 bottom-2 z-30 flex flex-col gap-2"
          >
            <div className="flex flex-col gap-2">
              {/* Each card starts where the folded pile had it — behind the
                  front card, a little lower, a little smaller — and eases up
                  into its place, the nearest first. */}
              {[...rest].reverse().map((card, index, reversed) => (
                <SpreadCard key={card.key} depth={reversed.length - index}>
                  {card.render(true)}
                </SpreadCard>
              ))}
              <SpreadCard depth={0}>{front.render(true)}</SpreadCard>
            </div>
            {/* The user card stays where it is; it only widens out of the
                inset it had in the pile. */}
            <motion.div
              className="shrink-0"
              initial="folded"
              animate="open"
              exit="folded"
              variants={{ folded: { paddingInline: 10 }, open: { paddingInline: 0 } }}
              transition={SPREAD_TRANSITION}
            >
              <IdentityCard underlap={0} inset={false} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </DockPinContext.Provider>
  );
}
