"use client";

import { useEffect, useState } from "react";
import { Gamepad2, Music, Tv, type LucideIcon } from "lucide-react";

import type { Id } from "../../convex/_generated/dataModel";
import { StreamBody } from "@/components/call/stream-preview-card";
import { useUserActivities } from "@/hooks/use-rich-presence";
import { cn } from "@/lib/utils";
import type { RichPresenceActivity, RichPresenceActivityType } from "@/types/desktop-api";

/** Icon per activity type — also used for the small badge next to a user's
 * status line (see `ActivityStatusIcon`). Streaming and watching share the TV,
 * since both mean "there is a screen involved". */
export const ACTIVITY_ICON: Record<RichPresenceActivityType, LucideIcon> = {
  playing: Gamepad2,
  listening: Music,
  watching: Tv,
  streaming: Tv,
};

export const ACTIVITY_VERB: Record<RichPresenceActivityType, string> = {
  playing: "Playing",
  listening: "Listening to",
  watching: "Watching",
  streaming: "Streaming",
};

/** `1:04:22` / `4:07`. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** A once-a-second clock, so the elapsed counter and the seek bar tick from
 * one timer rather than each running their own. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active]);
  return now;
}

/**
 * Where playback has reached right now, interpolated from the last position
 * the broadcaster reported. The OS only hands us a sample every few seconds
 * (and some players push one when playback starts and then never again), so
 * the bar advances locally between updates instead of being polled — the
 * reported position and its timestamp are the anchor, wall-clock does the rest.
 */
function interpolatePosition(activity: RichPresenceActivity, now: number): number | null {
  const { positionMs, positionUpdatedAt, durationMs } = activity;
  if (positionMs === undefined) return null;
  // `positionUpdatedAt` is Convex's clock and `now` is ours; a few seconds of
  // skew is invisible at this scale, and the clamp keeps it in range.
  const elapsed = positionUpdatedAt ? Math.max(0, now - positionUpdatedAt) : 0;
  const advanced = positionMs + elapsed;
  return durationMs ? Math.min(durationMs, advanced) : advanced;
}

/** The headline activity — the list arrives richest-first from the desktop
 * layer, so this is simply the first. */
export function topActivity(
  activities: RichPresenceActivity[] | null | undefined
): RichPresenceActivity | null {
  return activities?.[0] ?? null;
}

/** One-line summary of an activity, for compact rows (the member list) that
 * have no space for the full card. */
export function activitySummary(activity: RichPresenceActivity | null | undefined): string | null {
  if (!activity) return null;
  if (activity.type === "listening" && activity.details) {
    return activity.state ? `${activity.state}` : activity.details;
  }
  return `${ACTIVITY_VERB[activity.type]} ${activity.name}`;
}

/**
 * A small green glyph — controller, music notes or TV — for the activity a
 * user is broadcasting, sized to sit inline next to their status line. Renders
 * nothing when there's no activity, so it can be dropped in unconditionally.
 */
export function ActivityStatusIcon({
  activities,
  className,
}: {
  activities: RichPresenceActivity[] | null | undefined;
  className?: string;
}) {
  const activity = topActivity(activities);
  if (!activity) return null;

  const Icon = ACTIVITY_ICON[activity.type] ?? Gamepad2;
  const extra = (activities?.length ?? 0) - 1;
  const label = activities!.map((a) => `${ACTIVITY_VERB[a.type]} ${a.name}`).join(" · ");

  return (
    <span
      className={cn("flex shrink-0 items-center gap-0.5 text-emerald-500", className)}
      title={label}
      aria-label={label}
    >
      <Icon className="size-3 shrink-0" />
      {/* Only the headline gets an icon; the rest are summarised as a count
          so the status line stays one line wide. */}
      {extra > 0 && <span className="text-[10px] font-semibold leading-none">+{extra}</span>}
    </span>
  );
}

function Artwork({ activity, size }: { activity: RichPresenceActivity; size: "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [activity.imageUrl]);

  const Icon = ACTIVITY_ICON[activity.type] ?? Gamepad2;
  const show = !!activity.imageUrl && !failed;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded",
        size === "lg" ? "size-14" : "size-10"
      )}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={activity.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className={cn("text-muted-foreground", size === "lg" ? "size-6" : "size-5")} />
      )}
    </div>
  );
}

/** Album art, track / artist / album, and a live seek bar. */
function MediaBody({ activity }: { activity: RichPresenceActivity }) {
  const now = useNow(true);
  const position = interpolatePosition(activity, now);
  const duration = activity.durationMs;

  return (
    <>
      <div className="flex items-center gap-3">
        <Artwork activity={activity} size="lg" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{activity.details ?? activity.name}</p>
          {activity.state && (
            <p className="truncate text-xs text-muted-foreground">{activity.state}</p>
          )}
          {activity.album && (
            <p className="truncate text-xs text-muted-foreground/80">{activity.album}</p>
          )}
        </div>
      </div>

      {/* A bar needs a length to scale against. Plenty of sessions publish a
          position but no duration (see `resolveTrackInfo`), so those fall back
          to a plain elapsed readout rather than showing nothing. */}
      {position !== null && duration ? (
        <div className="mt-2.5">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-foreground/15"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration / 1000)}
            aria-valuenow={Math.round(position / 1000)}
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-1000 ease-linear"
              style={{ width: `${Math.min(100, (position / duration) * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>{formatClock(position)}</span>
            <span>{formatClock(duration)}</span>
          </div>
        </div>
      ) : position !== null ? (
        <p className="mt-2 text-[10px] tabular-nums text-muted-foreground">
          {formatClock(position)} elapsed
        </p>
      ) : null}
    </>
  );
}

/** Box art, game name, and how long they've been at it. */
function GameBody({ activity }: { activity: RichPresenceActivity }) {
  const now = useNow(!!activity.startedAt);

  return (
    <div className="flex items-center gap-2.5">
      <Artwork activity={activity} size="sm" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold">{activity.name}</p>
        {activity.details && (
          <p className="truncate text-xs text-muted-foreground">{activity.details}</p>
        )}
        {activity.state && (
          <p className="truncate text-xs text-muted-foreground">{activity.state}</p>
        )}
        {activity.startedAt && !activity.state && (
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {formatClock(now - activity.startedAt)} elapsed
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The "Playing …" / "Listening to …" block shown under a user's bio on the
 * profile cards. Renders nothing when the user isn't broadcasting anything,
 * so callers can drop it in unconditionally.
 */
export function RichPresenceCard({
  activity,
  className,
  onClick,
}: {
  activity: RichPresenceActivity | null | undefined;
  className?: string;
  /** Set by `RichPresenceCards` to fan a deck open (or fold it shut). */
  onClick?: () => void;
}) {
  if (!activity) return null;
  // Music and video get the media treatment — bigger art, a seek bar, and the
  // app name demoted to the header since the track is the headline.
  const isMedia = activity.type === "listening" || activity.type === "watching";
  // A stream's headline is the picture, so it gets the widescreen still rather
  // than a square of box art beside two lines of text.
  const isStream = activity.type === "streaming";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "rounded-md border border-border/40 bg-muted/30 px-3 py-2.5",
        onClick && "cursor-pointer transition-colors hover:bg-muted/50",
        className
      )}
    >
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {ACTIVITY_VERB[activity.type]}
        {(isMedia || isStream) && activity.name ? ` · ${activity.name}` : ""}
      </p>
      {isStream ? (
        <StreamBody
          label={activity.details ?? activity.name}
          thumbnailUrl={activity.imageUrl}
        />
      ) : isMedia ? (
        <MediaBody activity={activity} />
      ) : (
        <GameBody activity={activity} />
      )}
    </div>
  );
}

/** Vertical offset per card behind the front one, in px. */
const STACK_PEEK = 5;

/** However many activities there are, only this many sheets peek out — past
 * that the edges are too thin to read as anything but noise. */
const MAX_STACK_SHEETS = 2;

export function RichPresenceCards({
  activities,
  className,
  /** False where there's room to list everything (the profile dialog's own
   * activity column); true anywhere space is tight, like a popover. */
  stack = true,
}: {
  activities: RichPresenceActivity[] | null | undefined;
  className?: string;
  stack?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!activities?.length) return null;

  const showFlat = !stack || expanded || activities.length === 1;
  if (showFlat) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {activities.map((activity, index) => (
          <RichPresenceCard
            key={`${activity.type}-${activity.name}-${index}`}
            activity={activity}
            onClick={stack && expanded ? () => setExpanded(false) : undefined}
          />
        ))}
      </div>
    );
  }

  const [front, ...rest] = activities;
  const sheets = Math.min(rest.length, MAX_STACK_SHEETS);

  return (
    <div className={cn("relative", className)} style={{ paddingBottom: sheets * STACK_PEEK }}>
      {/* A grid with every child in the same cell makes the sheets exactly the
          front card's size without having to measure it — they're then nudged
          down and narrowed so only their bottom edge shows, like a deck. */}
      <div className="grid">
        {Array.from({ length: sheets }, (_, index) => {
          const depth = sheets - index;
          return (
            <div
              key={depth}
              aria-hidden
              className="col-start-1 row-start-1 rounded-md border border-border/40 bg-muted/30"
              style={{
                transform: `translateY(${depth * STACK_PEEK}px) scaleX(${1 - depth * 0.04})`,
                opacity: 1 - depth * 0.2,
              }}
            />
          );
        })}
        <RichPresenceCard
          activity={front}
          className="col-start-1 row-start-1 z-10"
          onClick={() => setExpanded(true)}
        />
      </div>

      <span className="pointer-events-none absolute right-2 top-2 z-20 rounded-full bg-background/80 px-1.5 text-[10px] font-semibold text-muted-foreground">
        +{rest.length}
      </span>
    </div>
  );
}

/** Convenience wrapper that looks the activities up by user id. */
export function UserRichPresenceCard({
  userId,
  className,
}: {
  userId: Id<"users">;
  className?: string;
}) {
  const activities = useUserActivities(userId);
  return <RichPresenceCards activities={activities} className={className} />;
}
