"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Maximize2, MonitorUp, PictureInPicture2, ScreenShareOff } from "lucide-react";
import {
  ParticipantEvent,
  Track,
  type Participant,
} from "livekit-client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCall, type CallVideoKind } from "@/components/call/call-provider";
import { useFeaturedSource } from "@/components/call/use-featured-source";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 16:9, small enough to sit over a message list without being in the way. */
const PIP_WIDTH = 288;
const PIP_HEIGHT = Math.round((PIP_WIDTH * 9) / 16);
/** Gap between the mini player and the window edge it's anchored to. */
const MARGIN = 16;
/** Pointer travel that turns a click into a drag, so nudging the player
 * doesn't open the call screen. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The featured participant's video, or their avatar when there's nothing to
 * show.
 *
 * Muted, always: the call's audio is already playing through the (hidden but
 * still mounted) call screen's own tiles, and a second attachment of the same
 * track would double it.
 */
function FeaturedVideo({
  participant,
  kind,
  fallback,
}: {
  participant: Participant;
  kind: CallVideoKind;
  fallback: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const source = kind === "screen" ? Track.Source.ScreenShare : Track.Source.Camera;
    let attached: Track | null = null;

    const sync = () => {
      const publication = participant.getTrackPublication(source);
      const track = publication?.track;
      // A muted camera publishes a black frame; the avatar is more honest.
      if (track && publication && !publication.isMuted && track.kind === Track.Kind.Video) {
        if (attached !== track) {
          attached?.detach(element);
          track.attach(element);
          attached = track;
        }
        setHasVideo(true);
        return;
      }
      attached?.detach(element);
      attached = null;
      element.srcObject = null;
      setHasVideo(false);
    };

    sync();
    participant
      .on(ParticipantEvent.TrackSubscribed, sync)
      .on(ParticipantEvent.TrackUnsubscribed, sync)
      .on(ParticipantEvent.TrackPublished, sync)
      .on(ParticipantEvent.TrackUnpublished, sync)
      .on(ParticipantEvent.TrackMuted, sync)
      .on(ParticipantEvent.TrackUnmuted, sync)
      .on(ParticipantEvent.LocalTrackPublished, sync)
      .on(ParticipantEvent.LocalTrackUnpublished, sync);
    return () => {
      participant
        .off(ParticipantEvent.TrackSubscribed, sync)
        .off(ParticipantEvent.TrackUnsubscribed, sync)
        .off(ParticipantEvent.TrackPublished, sync)
        .off(ParticipantEvent.TrackUnpublished, sync)
        .off(ParticipantEvent.TrackMuted, sync)
        .off(ParticipantEvent.TrackUnmuted, sync)
        .off(ParticipantEvent.LocalTrackPublished, sync)
        .off(ParticipantEvent.LocalTrackUnpublished, sync);
      attached?.detach(element);
    };
  }, [participant, kind]);

  return (
    <>
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className={cn("h-full w-full object-contain", !hasVideo && "hidden")}
      />
      {!hasVideo && fallback}
    </>
  );
}

/**
 * The call's mini player: what's left on screen once the full call screen is
 * collapsed.
 *
 * Navigating away from a call used to leave nothing but a "Voice Connected"
 * line on the user card — you could hear the call but not see any of it, and
 * getting back to a stream meant reopening the whole screen. This keeps the
 * most interesting thing in the call in the corner instead: whoever is
 * speaking, or a stream once the room goes quiet (see `useFeaturedSource` for
 * the rule). Clicking it opens the call screen again; the buttons on hover pop
 * the current stream out into its own always-on-top window, or stop watching it
 * without going back first.
 *
 * Mounted by `CallProvider` for the whole life of the call, not by the call
 * screen — it has to exist precisely when that screen doesn't, and staying
 * mounted is also what lets a player the user has dragged somewhere stay there
 * across expand/collapse.
 */
export function CallPip() {
  const {
    activeCall,
    expanded,
    expand,
    controller,
    watchedShares,
    unwatchShare,
    poppedOut,
    popOutSupported,
    popOut,
    closePopOut,
  } = useCall();
  const { room, participants, screenShares, status } = controller;

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  // Set when a drag ends and read by the click handler that fires immediately
  // after. It can't live on `dragRef` — `pointerup` comes *before* `click`,
  // so by the time the click arrives the drag has already been cleared and
  // "did this move?" has nowhere left to be read from. Which is why dragging
  // the player anywhere used to reopen the call screen on release.
  const suppressClickRef = useRef(false);

  const visible = !!activeCall && !expanded && status === "connected";

  const featured = useFeaturedSource({
    room,
    participants,
    screenShares,
    watchedShares,
    enabled: visible,
  });

  // Resolved the same way the call screen does it, so a per-server nickname or
  // avatar shows here exactly as it does there. One query for the whole room
  // rather than one per featured source, which would re-subscribe every time
  // the speaker changed.
  const identities = [room.localParticipant.identity, ...participants.map((p) => p.identity)];
  const profiles = useQuery(
    api.users.getUsersByIds,
    visible
      ? {
          userIds: identities as Id<"users">[],
          communityId: activeCall?.kind === "channel" ? activeCall.communityId : undefined,
        }
      : "skip"
  );

  // A window that's been dragged near an edge shouldn't end up off-screen when
  // the app window is made smaller.
  useEffect(() => {
    if (!visible) return;
    const clampToViewport = () => setOffset((prev) => clamp(prev));
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [visible]);

  if (!visible || !featured) return null;

  const profile = profiles?.find((u) => u.id === featured.identity);
  const name =
    profile?.name || featured.participant.name || featured.participant.identity;
  const isLocal = featured.identity === room.localParticipant.identity;
  const label = featured.kind === "screen" ? `${name}'s screen` : name;
  const canStopWatching = featured.kind === "screen" && !isLocal;
  const isPoppedOut =
    poppedOut?.identity === featured.identity && poppedOut.kind === featured.kind;

  const onPointerDown = (event: React.PointerEvent) => {
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    // Cleared here as well as on use, so a drag whose click never arrived
    // can't swallow the next real one.
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setOffset((prev) => clamp({ x: prev.x + dx, y: prev.y + dy }));
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    suppressClickRef.current = dragRef.current.moved;
    dragRef.current = null;
  };

  return (
    <div
      // Anchored bottom-right and moved with a transform, so "where the user
      // put it" is one offset rather than a position that has to be recomputed
      // whenever the window resizes.
      style={{
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
      className="group/pip fixed right-4 bottom-4 z-40 overflow-hidden rounded-xl border border-border/60 bg-black shadow-2xl"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => {
        // A drag that ended on this element still fires a click.
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        expand();
      }}
      role="button"
      tabIndex={0}
      aria-label={`Back to call — showing ${label}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          expand();
        }
      }}
    >
      <FeaturedVideo
        participant={featured.participant}
        kind={featured.kind}
        fallback={
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/20">
            {featured.kind === "screen" ? (
              <MonitorUp className="size-6 text-muted-foreground" />
            ) : (
              <Avatar size="lg">
                <AvatarImage src={profile?.imageUrl} alt={name} />
                <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
          </div>
        }
      />

      {/* Name, always visible — the player switches sources on its own, so
          which one it's showing can't be left implicit. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 pt-6 pb-1.5">
        {featured.kind === "screen" && <MonitorUp className="size-3 shrink-0 text-white/70" />}
        <span className="truncate text-[11px] font-medium text-white">{label}</span>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover/pip:opacity-100" />

      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/pip:opacity-100 focus-within:opacity-100">
        <TooltipProvider>
          {popOutSupported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  // Every button here stops propagation: the card itself is a
                  // button back to the call screen.
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isPoppedOut) closePopOut();
                    else
                      void popOut({
                        identity: featured.identity,
                        kind: featured.kind,
                        title: label,
                      });
                  }}
                  className={cn(
                    "rounded bg-black/60 p-1.5 text-white hover:bg-white/20",
                    isPoppedOut && "bg-white/25"
                  )}
                >
                  <PictureInPicture2 className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isPoppedOut ? "Close the popped-out window" : "Pop out into its own window"}
              </TooltipContent>
            </Tooltip>
          )}

          {canStopWatching && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    unwatchShare(featured.identity);
                  }}
                  className="rounded bg-black/60 p-1.5 text-white hover:bg-destructive/70"
                >
                  <ScreenShareOff className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Stop watching this stream</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  expand();
                }}
                className="rounded bg-black/60 p-1.5 text-white hover:bg-white/20"
              >
                <Maximize2 className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back to the call</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

/** Keep the player inside the app window, whatever it's been dragged towards. */
function clamp(offset: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === "undefined") return offset;
  const minX = -(window.innerWidth - PIP_WIDTH - MARGIN * 2);
  const minY = -(window.innerHeight - PIP_HEIGHT - MARGIN * 2);
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  };
}
