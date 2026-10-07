"use client";

import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { AlertTriangle, Armchair, Check, MicOff, Pencil, Users, X } from "lucide-react";
import { ParticipantEvent, RoomEvent, Track, type Participant } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { useCall } from "@/components/call/call-provider";
import { ControlBar } from "@/components/control-bar";
import { LoungeAvatar, useIsSpeaking } from "@/components/lounge/lounge-avatar";
import { LoungeChat, type LoungeChatMessage } from "@/components/lounge/lounge-chat";
import { EVENT_TTL, type LoungeEvent } from "@/components/lounge/lounge-effects";
import { SceneBackdrop, SceneBackground } from "@/components/lounge/scene-background";
import { ScenePropView, useLoungeProps } from "@/components/lounge/lounge-props";
import { LoungeRemote, TvScreen, type TvChannel } from "@/components/lounge/lounge-tv";
import { defaultSpot, useLoungePresence } from "@/components/lounge/use-lounge-presence";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSoundboardActivity } from "@/hooks/use-soundboard-activity";
import { useMediaDeviceAvailability } from "@/hooks/use-media-devices";
import type { RoomController } from "@/hooks/use-room";
import { resolveScene } from "@/lib/lounge-scenes";
import { cn } from "@/lib/utils";

/** How many people are drawn in the room; everyone past this is the audience. */
const MAX_ON_STAGE = 6;
/** The participant attribute that says "I'd rather watch from the audience". */
const AUDIENCE_ATTRIBUTE = "loungeAudience";

/** Whether a participant's mic is off and whether they are deafened, live. */
function useMicState(participant: Participant, localDeafened?: boolean) {
  const read = () => ({
    muted: !participant.isMicrophoneEnabled,
    deafened: participant.attributes?.deafened === "1",
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    const sync = () => setState(read());
    sync();
    const events = [
      ParticipantEvent.TrackMuted,
      ParticipantEvent.TrackUnmuted,
      ParticipantEvent.TrackSubscribed,
      ParticipantEvent.TrackUnsubscribed,
      ParticipantEvent.LocalTrackPublished,
      ParticipantEvent.LocalTrackUnpublished,
      ParticipantEvent.AttributesChanged,
    ] as const;
    events.forEach((e) => participant.on(e, sync));
    return () => {
      events.forEach((e) => participant.off(e, sync));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant]);
  return { muted: state.muted, deafened: localDeafened ?? state.deafened };
}

interface Profile {
  id: string;
  name?: string;
  imageUrl?: string;
  avatarDecoration?: string;
}

/** One person on stage: the connected avatar, with their live state. */
function StagePerson({
  participant,
  isLocal,
  profile,
  spot,
  depth,
  walking,
  typing,
  soundboard,
  chattedRecently,
  events,
  localDeafened,
}: {
  participant: Participant;
  isLocal: boolean;
  profile?: Profile;
  spot: { x: number; y: number; seat: number | null };
  depth: number;
  walking: boolean;
  typing: boolean;
  soundboard: boolean;
  chattedRecently: boolean;
  events: LoungeEvent[];
  localDeafened?: boolean;
}) {
  const { muted, deafened } = useMicState(participant, isLocal ? localDeafened : undefined);
  return (
    <LoungeAvatar
      participant={participant}
      isLocal={isLocal}
      name={profile?.name ?? participant.name ?? "Someone"}
      imageUrl={profile?.imageUrl}
      decoration={profile?.avatarDecoration}
      x={spot.x}
      y={spot.y}
      depth={depth}
      muted={muted}
      deafened={deafened}
      typing={typing}
      walking={walking}
      sitting={spot.seat !== null}
      soundboard={soundboard}
      chattedRecently={chattedRecently}
      events={events}
    />
  );
}

/** A line in the audience list. */
function AudienceRow({ participant, profile, isLocal }: { participant: Participant; profile?: Profile; isLocal: boolean }) {
  const speaking = useIsSpeaking(participant);
  const { muted } = useMicState(participant);
  const name = profile?.name ?? participant.name ?? "Someone";
  return (
    <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
      <Avatar className={cn("size-7 ring-2 transition-shadow", speaking && !muted ? "ring-emerald-400" : "ring-transparent")}>
        <AvatarImage src={profile?.imageUrl} alt="" />
        <AvatarFallback className="text-[10px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{isLocal ? `${name} (you)` : name}</span>
      {muted && <MicOff className="size-3.5 text-white/45" aria-label="Muted" />}
    </div>
  );
}

/** The room's topic: read by everyone in it, set by anyone in it. */
function Topic({ channelId, topic }: { channelId: Id<"channels">; topic?: string }) {
  const setTopic = useMutation(api.lounge.setTopic);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await setTopic({ channelId, topic: draft });
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? (e.message.split("\n")[0].replace(/^.*Error:\s*/, "") ?? "Couldn't change it.") : "Couldn't change it.");
    }
  };

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex items-center gap-1"
      >
        <input
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          placeholder="What's this room about?"
          className="h-7 w-64 rounded-md border border-white/15 bg-white/5 px-2 text-sm outline-none focus:border-white/30"
        />
        <Button type="submit" size="icon" variant="ghost" className="size-7" aria-label="Save topic">
          <Check className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => setEditing(false)} aria-label="Cancel">
          <X className="size-3.5" />
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(topic ?? "");
        setEditing(true);
      }}
      className="group flex max-w-md items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      title="Change the topic"
    >
      <span className={cn("truncate", !topic && "italic opacity-70")}>{topic || "Set a topic"}</span>
      <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
    </button>
  );
}

interface LoungeStageProps {
  roomName: string;
  controller: RoomController;
  onLeave: () => Promise<void>;
  channelId: Id<"channels">;
  communityId: Id<"communities">;
}

/**
 * A voice channel that is a room.
 *
 * Everybody in the call is drawn standing, sitting or walking in a scene whose
 * screen shows whichever shared screen the viewer has tuned to. Up to six people
 * are drawn; past that, the rest are the audience — in the corner button, in the
 * chat, and in the call just the same.
 */
export function LoungeStage({ roomName, controller, onLeave, channelId, communityId }: LoungeStageProps) {
  const {
    room,
    error,
    setError,
    participants,
    cameraEnabled,
    microphoneEnabled,
    screenSharing,
    screenShares,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
  } = controller;
  const { openSharePicker, openShareSettings, watchIntent, clearWatchIntent, watchShare, unwatchShare, watchedShares } = useCall();
  const { hasCamera, hasMicrophone } = useMediaDeviceAvailability();
  const { deafened, toggleDeafened } = useAudioPreferences();

  const channel = useQuery(api.channels.get, { channelId });
  const messagesQuery = useQuery(api.lounge.messages, { channelId });
  const scene = useMemo(() => resolveScene(channel ?? {}), [channel]);
  const soundboardActive = useSoundboardActivity();

  const me = room.localParticipant.identity;

  // Attributes arrive as events, not as props on a participant, so they are
  // what re-reads who is in the audience.
  const [, bump] = useState(0);
  useEffect(() => {
    const refresh = () => bump((n) => n + 1);
    room.on(RoomEvent.ParticipantAttributesChanged, refresh);
    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, refresh);
      room.off(RoomEvent.ParticipantConnected, refresh);
      room.off(RoomEvent.ParticipantDisconnected, refresh);
    };
  }, [room]);

  // --- who is on stage -------------------------------------------------------------
  const everyone = [
    room.localParticipant as Participant,
    ...participants.filter((p) => p.identity !== me),
  ].sort(
    // The same order on every screen, so everyone agrees who made the six.
    (a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0) || a.identity.localeCompare(b.identity),
  );
  const onStage: Participant[] = [];
  const inAudience: Participant[] = [];
  for (const p of everyone) {
    if (p.attributes?.[AUDIENCE_ATTRIBUTE] !== "1" && onStage.length < MAX_ON_STAGE) onStage.push(p);
    else inAudience.push(p);
  }
  const localOnStage = onStage.some((p) => p.identity === me);
  const wantsAudience = room.localParticipant.attributes?.[AUDIENCE_ATTRIBUTE] === "1";
  const toggleAudience = () =>
    void room.localParticipant.setAttributes({ [AUDIENCE_ATTRIBUTE]: wantsAudience ? "" : "1" }).catch(() => {});

  // --- who they are ----------------------------------------------------------------
  const profileData = useQuery(api.users.getUsersByIds, {
    userIds: everyone.map((p) => p.identity as Id<"users">),
    communityId,
  });
  const profiles = new Map<string, Profile>((profileData ?? []).map((u) => [u.id as string, u as Profile]));
  const nameOf = useCallback(
    (identity: string) => profiles.get(identity)?.name ?? "Someone",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileData],
  );

  // --- where they are --------------------------------------------------------------
  const presence = useLoungePresence(room, scene, localOnStage);
  // Props are the room's, not a person's: they sync whether or not you are on stage.
  const sceneProps = useLoungeProps(room, scene.props, true);

  // --- what they said ----------------------------------------------------------------
  const messages: LoungeChatMessage[] = messagesQuery ?? [];
  const [events, setEvents] = useState<LoungeEvent[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!messagesQuery) return;
    // What was said before we got here is history, not something to animate.
    if (seen.current === null) {
      seen.current = new Set(messagesQuery.map((m) => m.id));
      return;
    }
    const known = seen.current;
    const fresh = messagesQuery.filter((m) => !known.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => known.add(m.id));
    const at = Date.now();
    setClock(at);
    setEvents((prev) => [
      ...prev,
      ...fresh.map((m) => ({
        id: m.id,
        authorId: m.authorId,
        kind: m.kind,
        text: m.text,
        emoji: m.emoji,
        imageUrl: m.imageUrl,
        sticker: m.sticker,
        at,
      })),
    ]);
  }, [messagesQuery]);

  const hasEvents = events.length > 0;
  useEffect(() => {
    if (!hasEvents) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setClock(t);
      setEvents((prev) => {
        const next = prev.filter((e) => t - e.at < EVENT_TTL[e.kind]);
        return next.length === prev.length ? prev : next;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [hasEvents]);

  const eventsByAuthor = new Map<string, LoungeEvent[]>();
  for (const e of events) eventsByAuthor.set(e.authorId, [...(eventsByAuthor.get(e.authorId) ?? []), e]);

  // --- the TV ------------------------------------------------------------------------
  const channels: TvChannel[] = everyone
    .filter((p) => {
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
      return screenShares.includes(p.identity) && !!pub && !pub.isMuted;
    })
    .map((p) => ({ identity: p.identity, name: `${profiles.get(p.identity)?.name ?? "Someone"}'s screen` }));

  const [tuned, setTuned] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [tvMuted, setTvMuted] = useState(false);
  const [focused, setFocused] = useState(false);
  const turnedOff = useRef(false);

  const dropWatched = useCallback(() => {
    watchedShares.forEach((id) => unwatchShare(id));
  }, [watchedShares, unwatchShare]);

  const tune = useCallback(
    (identity: string) => {
      turnedOff.current = false;
      setTuned(identity);
      // Watching one stream drops the others, which is what makes changing
      // channel end one download and start another. Your own share is already
      // here and needs no subscription.
      if (identity === me) dropWatched();
      else watchShare(identity, { replace: true });
    },
    [me, dropWatched, watchShare],
  );

  const turnOff = useCallback(() => {
    turnedOff.current = true;
    setTuned(null);
    dropWatched();
  }, [dropWatched]);

  const channelKey = channels.map((c) => c.identity).join("|");
  useEffect(() => {
    const live = channelKey ? channelKey.split("|") : [];
    if (live.length === 0) turnedOff.current = false;
    // Whoever was on has stopped sharing: the set goes back to static.
    if (tuned && !live.includes(tuned)) {
      setTuned(null);
      dropWatched();
      return;
    }
    // "Join and watch" from the activity feed names who to tune to.
    if (watchIntent && live.includes(watchIntent)) {
      tune(watchIntent);
      clearWatchIntent();
      return;
    }
    // A TV with something on is the point of the room: switch it on for whoever
    // hasn't switched it off.
    if (!tuned && live.length > 0 && !turnedOff.current && !watchIntent) tune(live[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, tuned, watchIntent]);

  const tunedChannel = channels.find((c) => c.identity === tuned) ?? null;

  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocused(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);

  // Leaning in: scale the room so the screen fills the frame. The transform
  // origin is the top-left corner, so a point at (x%, y%) lands at
  // translate + scale·(x%, y%) — which is what centres the screen.
  const zoom = useMemo(() => {
    const { x, y, w, h } = scene.screen;
    const scale = Math.min(95 / w, 95 / h);
    return { scale, x: `${50 - scale * (x + w / 2)}%`, y: `${50 - scale * (y + h / 2)}%` };
  }, [scene.screen]);

  // --- the floor -------------------------------------------------------------------
  const sceneRef = useRef<HTMLDivElement>(null);
  const onFloorClick = (e: React.MouseEvent) => {
    if (!localOnStage || focused || !sceneRef.current) return;
    const rect = sceneRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (y < scene.floorTop) return;
    presence.walkTo(x, y);
  };

  const takenSeats = new Set<number>();
  presence.spots.forEach((s, id) => {
    if (s.seat !== null && id !== me && onStage.some((p) => p.identity === id)) takenSeats.add(s.seat);
  });

  const mySeat = presence.spots.get(me)?.seat ?? null;
  const screen = scene.screen;

  // Scenes that ask for it put their lights down once anyone is showing something
  // (the cinema always has).
  const lightsDown = scene.lights.dimOnShare && channels.length > 0;

  const art = scene.backgroundUrl ? (
    <div className="absolute inset-0">
      <SceneBackground url={scene.backgroundUrl} />
    </div>
  ) : (
    <svg viewBox="0 0 160 90" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
      {scene.art}
    </svg>
  );

  return (
    // The room is the whole page; everything else is laid over it.
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-neutral-950 text-white">
      {/* Whatever the window's shape, the room reaches its edges: the same picture,
          blurred, behind the 16:9 scene. */}
      <div aria-hidden className="absolute inset-0 scale-110 opacity-70 blur-2xl">
        {scene.backgroundUrl ? (
          <SceneBackdrop url={scene.backgroundUrl} />
        ) : (
          <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className="size-full">
            {scene.art}
          </svg>
        )}
      </div>

      <div className="absolute inset-0 flex items-center justify-center [container-type:size]">
        <div
          ref={sceneRef}
          onClick={onFloorClick}
          className="group/stage relative overflow-hidden shadow-2xl shadow-black/50 [container-type:inline-size]"
          style={{ aspectRatio: "16 / 9", width: "min(100cqw, calc(100cqh * 16 / 9))" }}
        >
          <motion.div
            className="absolute inset-0"
            style={{ transformOrigin: "0% 0%" }}
            initial={false}
            animate={focused ? { scale: zoom.scale, x: zoom.x, y: zoom.y } : { scale: 1, x: "0%", y: "0%" }}
            transition={{ type: "spring", stiffness: 140, damping: 24, mass: 0.9 }}
          >
            {art}

            {/* Lights down: the room darkens and the screen throws its light on it. */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[#05030a]"
              initial={false}
              animate={{ opacity: lightsDown ? scene.lights.amount : 0 }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 mix-blend-screen"
              style={{
                background: `radial-gradient(ellipse 60% 55% at ${screen.x + screen.w / 2}% ${screen.y + screen.h}%, rgba(150,185,255,0.3), transparent 70%)`,
              }}
              initial={false}
              animate={{ opacity: lightsDown ? 1 : 0 }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            />

            <div
              className={cn("absolute", focused ? "cursor-zoom-out" : "cursor-zoom-in")}
              style={{ left: `${screen.x}%`, top: `${screen.y}%`, width: `${screen.w}%`, height: `${screen.h}%` }}
              onClick={(e) => {
                e.stopPropagation();
                setFocused((f) => !f);
              }}
            >
              <TvScreen
                room={room}
                channel={tunedChannel}
                volume={volume}
                // Your own share's sound is already in your ears.
                muted={tvMuted || tuned === me}
                liveCount={channels.length}
              />
            </div>

            {/* Seats, shown when the pointer is over the room — exactly where the
                person sitting there will be drawn. */}
            {localOnStage &&
              !focused &&
              scene.seats.map((seat, i) =>
                takenSeats.has(i) || mySeat === i ? null : (
                  <button
                    key={i}
                    type="button"
                    aria-label="Sit here"
                    onClick={(e) => {
                      e.stopPropagation();
                      presence.sitAt(i);
                    }}
                    className="absolute z-[2] flex size-[2.6cqw] items-center justify-center rounded-full border border-dashed border-white/70 bg-white/10 text-white opacity-0 transition-opacity group-hover/stage:opacity-45 hover:!opacity-100"
                    style={{ left: `${seat.x}%`, top: `${seat.y}%`, transform: "translate(-50%, -88%)" }}
                  >
                    <Armchair className="size-[55%]" />
                  </button>
                ),
              )}

            {scene.props.map((prop) => (
              <ScenePropView
                key={prop.id}
                prop={prop}
                on={sceneProps.isOn(prop.id)}
                onToggle={() => sceneProps.toggle(prop.id)}
                disabled={focused}
              />
            ))}

            <motion.div
              className="absolute inset-0"
              initial={false}
              animate={{ filter: lightsDown ? "brightness(0.72)" : "brightness(1)" }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            >
              {onStage.map((p) => {
                const spot = presence.spots.get(p.identity) ?? defaultSpot(p.identity, scene);
                const depth = Math.min(1, Math.max(0, (spot.y - scene.floorTop) / (100 - scene.floorTop)));
                const authored = eventsByAuthor.get(p.identity) ?? [];
                return (
                  <StagePerson
                    key={p.identity}
                    participant={p}
                    isLocal={p.identity === me}
                    profile={profiles.get(p.identity)}
                    spot={spot}
                    depth={depth}
                    walking={presence.walking.has(p.identity)}
                    typing={presence.typing.has(p.identity)}
                    soundboard={soundboardActive.has(p.identity)}
                    chattedRecently={authored.some((e) => (e.kind === "text" || e.kind === "image") && clock - e.at < 2500)}
                    events={authored}
                    localDeafened={deafened}
                  />
                );
              })}
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* --- the HUD: laid over the room, never beside it ------------------------------- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/85 via-black/45 to-transparent p-3 pb-14">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base font-semibold drop-shadow">{roomName}</h1>
          <Badge variant="secondary" className="bg-white/15 text-white">
            {everyone.length} in lounge
          </Badge>
          <Topic channelId={channelId} topic={channel?.loungeTopic} />
        </div>
        <span className="hidden text-xs text-white/55 sm:block">
          {localOnStage ? "WASD or arrows to walk · click the floor · click a seat to sit" : "You're in the audience"}
        </span>
      </div>

      {error && (
        <div className="pointer-events-auto absolute top-14 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border border-destructive/40 bg-neutral-950/90 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="size-4" />
          <span>{error}</span>
          <button className="ml-2 text-xs underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-16">
        <div className="pointer-events-auto flex min-w-0 justify-start">
          <div className="flex items-center gap-0.5 rounded-full border border-white/12 bg-neutral-900/80 p-1">
            <LoungeRemote
              channels={channels}
              current={tuned}
              onTune={tune}
              onOff={turnOff}
              volume={volume}
              onVolume={setVolume}
              muted={tvMuted}
              onMuted={setTvMuted}
              focused={focused}
              onFocus={() => setFocused((f) => !f)}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full px-3 text-white hover:bg-white/10 hover:text-white">
                  <Users className="size-4" />
                  Audience
                  {inAudience.length > 0 && (
                    <span className="rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{inAudience.length}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-64 rounded-2xl border-white/10 bg-neutral-900/95 p-2 text-white">
                <p className="px-1.5 pb-1 text-[11px] font-semibold tracking-wide text-white/50 uppercase">
                  {inAudience.length > 0 ? "In the audience" : "Nobody's in the audience"}
                </p>
                <div className="max-h-64 overflow-y-auto">
                  {inAudience.map((p) => (
                    <AudienceRow key={p.identity} participant={p} profile={profiles.get(p.identity)} isLocal={p.identity === me} />
                  ))}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={toggleAudience}
                  // Taking a spot back needs one to be free.
                  disabled={wantsAudience && onStage.length >= MAX_ON_STAGE}
                  className="mt-2 w-full gap-1.5 rounded-xl"
                >
                  <Armchair className="size-4" />
                  {wantsAudience ? "Take a spot" : "Watch from the audience"}
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* A fixed slot with the bar anchored to its bottom, so it grows upward
            over the room when the device pickers open. */}
        <div className="pointer-events-none relative h-[62px] w-[392px]">
          <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex justify-center">
            <ControlBar
              cameraEnabled={cameraEnabled}
              microphoneEnabled={microphoneEnabled}
              deafened={deafened}
              screenSharing={screenSharing}
              cameraAvailable={hasCamera}
              microphoneAvailable={hasMicrophone}
              onToggleCamera={toggleCamera}
              onToggleMicrophone={toggleMicrophone}
              onToggleDeafen={toggleDeafened}
              onToggleScreenShare={() => (screenSharing ? void toggleScreenShare() : openSharePicker())}
              onOpenShareSettings={openShareSettings}
              onLeave={onLeave}
              busy={false}
            />
          </div>
        </div>

        <div className="pointer-events-auto flex min-w-0 justify-end">
          <LoungeChat
            channelId={channelId}
            communityId={communityId}
            messages={messages}
            nameOf={nameOf}
            audience={!localOnStage}
            onTyping={presence.sendTyping}
          />
        </div>
      </div>
    </div>
  );
}
