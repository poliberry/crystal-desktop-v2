"use client";

import { useEffect, useRef, useState } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { RoomEvent, Track, type Participant } from "livekit-client";
import {
  Maximize,
  PictureInPicture2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { useAudioPreferences } from "@/components/audio-provider";
import { useCall, type CallVideoKind } from "@/components/call/call-provider";
import { ParticipantModerationItems } from "@/components/call/participant-moderation-items";
import { PendingParticipantTile } from "@/components/call/pending-participant-tile";
import { useSoundboardActivity } from "@/hooks/use-soundboard-activity";
import { ParticipantTile } from "@/components/participant-tile";
import { ScreenShareTile } from "@/components/screen-share-tile";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface CallTile {
  key: string;
  kind: "participant" | "screen";
  participant: Participant;
  isLocal: boolean;
  imageUrl?: string;
  /** Cached dominant colour of the avatar, so the tile paints its tint on
   * the first frame instead of flashing while it re-samples the image. */
  accent?: string;
  /** The participant's profile border gradient, resolved against this call's
   * community like the name below. Painted as the tile's backdrop; tiles
   * without one keep the avatar accent above — see `ParticipantTile`. */
  gradientStart?: string;
  gradientEnd?: string;
  /** The decoration worn around the participant's avatar, resolved against
   * this call's community like the name below. */
  avatarDecoration?: string;
  /** Name and avatar as this call's community sees them — a per-server
   * nickname wins over the one baked into the LiveKit token at join time
   * (see `RoomView`). Absent in DM calls, which have no server identity. */
  name?: string;
}

/**
 * Someone who belongs to a DM or group call but hasn't joined yet. Kept
 * separate from `CallTile` rather than folded into it as another `kind`,
 * because everything a tile does — volume, watch state, context menu — needs
 * a live LiveKit `Participant` that these don't have.
 */
export interface PendingParticipant {
  userId: string;
  name: string;
  imageUrl?: string;
  /** False once their ring lapsed, so a missed call stops pulsing. */
  ringing: boolean;
}

interface CallGridProps {
  tiles: CallTile[];
  /** Conversation members not yet connected — shown as pulsing placeholders
   * beside the real tiles so a call looks like the room it will become. */
  pending?: PendingParticipant[];
  /** Set only in a community voice channel — enables the per-participant
   * moderation items in the tile context menu. */
  moderation?: { communityId: Id<"communities">; channelId: Id<"channels"> };
  /** Whose share to open and focus as soon as it shows up — set when the user
   * arrived here by clicking a stream in the activity feed. Consumed once,
   * via `onAutoWatched`, so it doesn't fight them later. */
  autoWatchIdentity?: string | null;
  onAutoWatched?: () => void;
}

interface WatchState {
  watching: boolean;
  canWatch: boolean;
  audioEnabled: boolean;
  onWatch: () => void;
  onWatchAdd?: () => void;
}

interface TileSettings {
  volume: number;
  muted: boolean;
}

const GAP = 8;

function TileWithContextMenu({
  tile,
  onClick,
  watchState,
  settings,
  onVolumeChange,
  onMuteToggle,
  moderation,
  avatarSize,
}: {
  tile: CallTile;
  onClick: () => void;
  watchState?: WatchState;
  settings: TileSettings;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  /** Set only in a community voice channel — a DM call has no roles to
   * moderate under. */
  moderation?: { communityId: Id<"communities">; channelId: Id<"channels"> };
  /** Passed to `ParticipantTile` — the expanded view draws the smaller
   * avatar, in both the focused tile and the rail beside it. */
  avatarSize?: "default" | "sm";
}) {
  const soundboardActive = useSoundboardActivity().has(
    tile.participant.identity,
  );
  const name = tile.name || tile.participant.name || tile.participant.identity;
  const displayName = tile.kind === "screen" ? `${name}'s screen` : name;

  const inner =
    tile.kind === "screen" ? (
      <ScreenShareTile
        participant={tile.participant}
        isLocal={tile.isLocal}
        name={tile.name}
        fill
        onClick={onClick}
        audioEnabled={watchState?.audioEnabled ?? true}
        watching={watchState?.watching}
        canWatch={watchState?.canWatch}
        onWatch={watchState?.onWatch}
        onWatchAdd={watchState?.onWatchAdd}
        localVolume={settings.volume}
        localMuted={settings.muted}
      />
    ) : (
      <ParticipantTile
        participant={tile.participant}
        isLocal={tile.isLocal}
        imageUrl={tile.imageUrl}
        name={tile.name}
        accent={tile.accent}
        gradientStart={tile.gradientStart}
        gradientEnd={tile.gradientEnd}
        avatarDecoration={tile.avatarDecoration}
        avatarSize={avatarSize}
        fill
        onClick={onClick}
        localVolume={settings.volume}
        localMuted={settings.muted}
        soundboardActive={soundboardActive}
      />
    );

  if (tile.isLocal) return inner;

  const effectiveVolume = settings.muted ? 0 : settings.volume;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full w-full">
        {inner}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="truncate">{displayName}</ContextMenuLabel>
        <ContextMenuSeparator />
        {/* Slider must stop pointer events from bubbling or Radix closes the menu */}
        <div className="px-2 py-2" onPointerDown={(e) => e.stopPropagation()}>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            {settings.muted ? (
              <VolumeX className="size-3.5" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
            <span className="flex-1">Volume</span>
            <span className="tabular-nums">
              {Math.round(effectiveVolume * 100)}%
            </span>
          </div>
          <Slider
            value={[Math.round(effectiveVolume * 100)]}
            onValueChange={([v]) => {
              if (settings.muted && v > 0) onMuteToggle();
              onVolumeChange(v / 100);
            }}
            min={0}
            max={100}
            step={1}
          />
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onMuteToggle}>
          {settings.muted ? (
            <>
              <Volume2 className="mr-2 size-4" />
              Unmute for me
            </>
          ) : (
            <>
              <VolumeX className="mr-2 size-4" />
              Mute for me
            </>
          )}
        </ContextMenuItem>

        {moderation && (
          <ParticipantModerationItems
            communityId={moderation.communityId}
            channelId={moderation.channelId}
            userId={tile.participant.identity as Id<"users">}
            name={name}
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Whether a participant currently has a live, unmuted camera track —
 * zoom/pop-out only make sense when there's actual video to act on (not an
 * avatar placeholder), and this needs to stay reactive since a participant
 * can toggle their camera on/off while focused. */
function useParticipantCameraFeed(participant: Participant): boolean {
  const compute = () => {
    const pub = participant.getTrackPublication(Track.Source.Camera);
    return !!(pub?.track && !pub.isMuted);
  };
  const [hasCamera, setHasCamera] = useState(compute);

  useEffect(() => {
    setHasCamera(compute());
    const refresh = (pub?: { source?: Track.Source }) => {
      if (!pub || pub.source === Track.Source.Camera) setHasCamera(compute());
    };
    participant
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh);
    return () => {
      participant
        .off(RoomEvent.TrackSubscribed, refresh)
        .off(RoomEvent.TrackUnsubscribed, refresh)
        .off(RoomEvent.LocalTrackPublished, refresh)
        .off(RoomEvent.LocalTrackUnpublished, refresh)
        .off(RoomEvent.TrackMuted, refresh)
        .off(RoomEvent.TrackUnmuted, refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant]);

  return hasCamera;
}

/** The focused/"expanded" tile: adds scroll-to-zoom + drag-to-pan on the
 * video content, plus a toolbar to reset zoom and pop the tile out into a
 * separate always-on-top window. */
function FocusedTileViewport({
  tile,
  displayName,
  onUnfocus,
  watchState,
  settings,
  onVolumeChange,
  onMuteToggle,
  moderation,
}: {
  tile: CallTile;
  displayName: string;
  onUnfocus: () => void;
  watchState?: WatchState;
  settings: TileSettings;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  /** Passed through to each tile's context menu; see `CallGridProps`. */
  moderation?: { communityId: Id<"communities">; channelId: Id<"channels"> };
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  // The pop-out window belongs to the call, not to this tile — see
  // CallProvider. Focusing a different tile no longer closes it, and neither
  // does collapsing the call screen: what's been popped out stays popped out
  // until it's closed or its source goes away.
  const { poppedOut, popOutSupported, popOut, closePopOut } = useCall();
  const videoKind: CallVideoKind = tile.kind === "screen" ? "screen" : "camera";
  const pipOpen =
    poppedOut?.identity === tile.participant.identity && poppedOut.kind === videoKind;
  const cameraHasVideo = useParticipantCameraFeed(tile.participant);
  const hasVideo = tile.kind === "screen" || cameraHasVideo;

  // Reset zoom/pan whenever the focused tile changes (new participant/share).
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile.key]);

  // While this tile is popped out, its on-screen video is paused (frozen, and
  // already hidden behind the overlay below) so the main UI isn't still
  // decoding and painting a full-size copy nobody can see. The frames the
  // pop-out window draws come from CallProvider's own capture loop, which
  // attaches a second element to the same track.
  useEffect(() => {
    if (!pipOpen) return;
    const visibleVideo = videoContainerRef.current?.querySelector("video") ?? null;
    visibleVideo?.pause();
    return () => {
      void visibleVideo?.play().catch(() => {});
    };
  }, [pipOpen]);

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  /**
   * Clamp a pan offset to what the current zoom actually allows.
   *
   * The transform is `scale(z) translate(pan)`, so a pan of `p` moves the
   * content `z * p` on screen while the zoomed content only overhangs the
   * viewport by `size * (z - 1) / 2` in each direction. Anything past that is
   * pulling the video away from an edge and showing background.
   *
   * At zoom 1 the limit is 0, which is what fixes zooming back out after
   * panning: the offset used to survive the zoom change, leaving the video
   * sitting off-centre at 100%.
   */
  const clampPan = (pan: { x: number; y: number }, zoom: number) => {
    const el = videoContainerRef.current;
    if (!el || zoom <= 1) return { x: 0, y: 0 };
    const maxX = (el.clientWidth * (zoom - 1)) / (2 * zoom);
    const maxY = (el.clientHeight * (zoom - 1)) / (2 * zoom);
    return {
      x: Math.min(maxX, Math.max(-maxX, pan.x)),
      y: Math.min(maxY, Math.max(-maxY, pan.y)),
    };
  };

  /** The only way zoom changes — pan is re-clamped in the same breath, so the
   * two can't get out of step. */
  const applyZoom = (next: number) => {
    const zoomed = clampZoom(next);
    setZoom(zoomed);
    setPan((p) => clampPan(p, zoomed));
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!e.deltaY || pipOpen) return;
    e.preventDefault();
    applyZoom(zoom - e.deltaY * 0.0015);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    // Clamped as it moves, so a drag can't push the video off an edge either.
    setPan((p) => clampPan({ x: p.x + dx / zoom, y: p.y + dy / zoom }, zoom));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleTileClick = () => {
    if (dragRef.current?.moved) return;
    onUnfocus();
  };

  const handlePopOutToggle = async () => {
    if (pipOpen) {
      closePopOut();
      return;
    }
    await popOut({
      identity: tile.participant.identity,
      kind: videoKind,
      title: displayName,
    });
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-lg bg-black/20"
      onWheel={handleWheel}
    >
      <div
        ref={videoContainerRef}
        className="h-full w-full"
        style={{
          transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
          transformOrigin: "center center",
          cursor: zoom > 1 ? "grab" : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <TileWithContextMenu
          moderation={moderation}
          tile={tile}
          avatarSize="sm"
          onClick={handleTileClick}
          watchState={watchState}
          settings={settings}
          onVolumeChange={onVolumeChange}
          onMuteToggle={onMuteToggle}
        />
      </div>

      {/* The visible video is paused (frozen) while popped out — a hidden
          second element attached to the same track keeps feeding the pip
          capture loop instead (see the effect above). */}
      {pipOpen && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-black/95 text-sm text-white">
          <PictureInPicture2 className="size-6 text-white/60" />
          <span className="text-white/80">{displayName} is popped out</span>
          <button
            type="button"
            onClick={closePopOut}
            className="rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
          >
            Bring back
          </button>
        </div>
      )}

      {hasVideo && (
        <div
          className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-md bg-black/60 p-1 text-white backdrop-blur"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            title="Zoom out"
            onClick={() => applyZoom(zoom - 0.25)}
            className="rounded p-1 hover:bg-white/10 disabled:opacity-40"
            disabled={zoom <= MIN_ZOOM}
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="min-w-9 text-center text-[11px] tabular-nums text-white/80">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            title="Zoom in"
            onClick={() => applyZoom(zoom + 0.25)}
            className="rounded p-1 hover:bg-white/10 disabled:opacity-40"
            disabled={zoom >= MAX_ZOOM}
          >
            <ZoomIn className="size-3.5" />
          </button>
          {zoom !== 1 && (
            <button
              type="button"
              title="Reset zoom"
              onClick={resetZoom}
              className="rounded p-1 hover:bg-white/10"
            >
              <Maximize className="size-3.5" />
            </button>
          )}
          {popOutSupported && (
            <button
              type="button"
              title={
                pipOpen
                  ? "Close the popped-out window"
                  : "Pop out into a separate window"
              }
              onClick={() => void handlePopOutToggle()}
              className={cn(
                "rounded p-1 hover:bg-white/10",
                pipOpen && "bg-white/20",
              )}
            >
              <PictureInPicture2 className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GalleryGrid({
  tiles,
  pending,
  onFocus,
  getWatchState,
  getSettings,
  onVolumeChange,
  onMuteToggle,
  moderation,
}: {
  tiles: CallTile[];
  pending: PendingParticipant[];
  onFocus: (key: string) => void;
  getWatchState: (tile: CallTile) => WatchState | undefined;
  getSettings: (tile: CallTile) => TileSettings;
  onVolumeChange: (tile: CallTile, v: number) => void;
  onMuteToggle: (tile: CallTile) => void;
  /** Passed through to each tile's context menu; see `CallGridProps`. */
  moderation?: { communityId: Id<"communities">; channelId: Id<"channels"> };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Placeholders occupy real cells, so the grid doesn't reflow when someone
  // answers — their card is simply swapped for a live tile.
  const cells: ({ tile: CallTile } | { pending: PendingParticipant })[] = [
    ...tiles.map((tile) => ({ tile })),
    ...pending.map((p) => ({ pending: p })),
  ];
  const n = cells.length;
  const cols = n <= 1 ? 1 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  let tileW = 300;
  let tileH = 169;

  if (size) {
    const maxTileW = (size.w - GAP * (cols - 1)) / cols;
    const maxTileH = (size.h - GAP * (rows - 1)) / rows;
    tileW = Math.max(Math.min(maxTileW, maxTileH * (16 / 9)), 80);
    tileH = tileW * (9 / 16);
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    >
      <div className="flex flex-col items-center" style={{ gap: GAP }}>
        {Array.from({ length: rows }, (_, rowIndex) => {
          const rowCells = cells.slice(rowIndex * cols, (rowIndex + 1) * cols);
          return (
            <div key={rowIndex} className="flex" style={{ gap: GAP }}>
              {rowCells.map((cell) =>
                "pending" in cell ? (
                  <div
                    key={`pending-${cell.pending.userId}`}
                    className="shrink-0 overflow-hidden rounded-lg"
                    style={{ width: tileW, height: tileH }}
                  >
                    <PendingParticipantTile
                      name={cell.pending.name}
                      imageUrl={cell.pending.imageUrl}
                      ringing={cell.pending.ringing}
                      fill
                    />
                  </div>
                ) : (
                  ((tile) => (
                    <div
                      key={tile.key}
                      className="shrink-0 overflow-hidden rounded-lg"
                      style={{ width: tileW, height: tileH }}
                    >
                      <TileWithContextMenu
                        moderation={moderation}
                        tile={tile}
                        onClick={() => onFocus(tile.key)}
                        watchState={getWatchState(tile)}
                        settings={getSettings(tile)}
                        onVolumeChange={(v) => onVolumeChange(tile, v)}
                        onMuteToggle={() => onMuteToggle(tile)}
                      />
                    </div>
                  ))(cell.tile)
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CallGrid({
  tiles,
  pending = [],
  moderation,
  autoWatchIdentity,
  onAutoWatched,
}: CallGridProps) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  /**
   * Local volume and mute, per *tile* rather than per participant: someone's
   * camera tile carries their microphone and their screen tile carries the
   * share's own audio, which are two unrelated things to turn down. Keyed by
   * `tile.key` ("cam-"/"screen-" plus the identity), so pulling a stream's
   * volume down no longer takes the person's voice with it.
   */
  const [tileSettings, setTileSettings] = useState<Map<string, TileSettings>>(
    new Map()
  );
  // The starting point for tiles with no entry in that map — a saved
  // preference, so it survives leaving and re-joining calls.
  const { participantVolume, streamVolume } = useAudioPreferences();
  // Which streams are being watched is call state, not grid state — the mini
  // player shows and stops them while this component isn't even on screen.
  // Pruning a share that ends lives there too (see CallProvider).
  const { watchedShares, watchShare, unwatchShare } = useCall();

  useEffect(() => {
    if (focusedKey && !tiles.some((t) => t.key === focusedKey))
      setFocusedKey(null);
  }, [tiles, focusedKey]);

  const getWatchState = (tile: CallTile): WatchState | undefined => {
    if (tile.kind !== "screen" || tile.isLocal) return undefined;
    const identity = tile.participant.identity;
    const watching = watchedShares.includes(identity);
    const audioEnabled = watchedShares.length === 0 || watching;
    return {
      watching,
      canWatch: true,
      audioEnabled,
      onWatch: watching
        ? () => unwatchShare(identity)
        : () => watchShare(identity, { replace: true }),
      onWatchAdd:
        !watching && watchedShares.length > 0 ? () => watchShare(identity) : undefined,
    };
  };

  /**
   * Honour "join and watch": the stream the user clicked in the activity feed
   * isn't published yet when the join completes, so this waits for its tile
   * and then opens it focused. Consumed once — after that, what's on screen is
   * the user's business.
   */
  useEffect(() => {
    if (!autoWatchIdentity) return;
    const tile = tiles.find(
      (t) => t.kind === "screen" && t.participant.identity === autoWatchIdentity
    );
    if (!tile) return;
    watchShare(autoWatchIdentity, { replace: true });
    setFocusedKey(tile.key);
    onAutoWatched?.();
  }, [autoWatchIdentity, tiles, watchShare, onAutoWatched]);

  /** Where a tile nobody has touched starts: the user's global default for
   * that kind of audio. Read live rather than snapshotted into `tileSettings`
   * on join, so changing the default in Settings moves every untouched tile in
   * the call that's already running — and so it applies again next time. */
  const defaultSettings = (tile: CallTile): TileSettings => ({
    volume: tile.kind === "screen" ? streamVolume : participantVolume,
    muted: false,
  });

  const getSettings = (tile: CallTile) =>
    tileSettings.get(tile.key) ?? defaultSettings(tile);

  const updateVolume = (tile: CallTile, volume: number) =>
    setTileSettings((prev) => {
      const cur = prev.get(tile.key) ?? defaultSettings(tile);
      return new Map(prev).set(tile.key, { ...cur, volume });
    });

  const toggleMute = (tile: CallTile) =>
    setTileSettings((prev) => {
      const cur = prev.get(tile.key) ?? defaultSettings(tile);
      return new Map(prev).set(tile.key, { ...cur, muted: !cur.muted });
    });

  if (tiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Waiting for others to join…
      </div>
    );
  }

  const focused = tiles.find((t) => t.key === focusedKey) ?? null;

  if (focused) {
    const rest = tiles.filter((t) => t.key !== focused.key);
    const focusedName =
      focused.name || focused.participant.name || focused.participant.identity;
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="min-h-0 flex-1">
          <FocusedTileViewport
            tile={focused}
            displayName={
              focused.kind === "screen"
                ? `${focusedName}'s screen`
                : focusedName
            }
            onUnfocus={() => setFocusedKey(null)}
            watchState={getWatchState(focused)}
            settings={getSettings(focused)}
            onVolumeChange={(v) => updateVolume(focused, v)}
            onMuteToggle={() => toggleMute(focused)}
            moderation={moderation}
          />
        </div>
        {rest.length > 0 && (
          <div className="flex h-28 shrink-0 justify-center gap-2 overflow-x-auto">
            {rest.map((tile) => (
              <div key={tile.key} className="h-full w-44 shrink-0">
                <TileWithContextMenu
                  moderation={moderation}
                  tile={tile}
                  avatarSize="sm"
                  onClick={() => setFocusedKey(tile.key)}
                  watchState={getWatchState(tile)}
                  settings={getSettings(tile)}
                  onVolumeChange={(v) => updateVolume(tile, v)}
                  onMuteToggle={() => toggleMute(tile)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <GalleryGrid
      tiles={tiles}
      pending={pending}
      onFocus={setFocusedKey}
      getWatchState={getWatchState}
      getSettings={getSettings}
      onVolumeChange={updateVolume}
      onMuteToggle={toggleMute}
      moderation={moderation}
    />
  );
}
