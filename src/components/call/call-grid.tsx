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
import { usePipWindow } from "@/hooks/use-pip-window";
import { cn } from "@/lib/utils";

export interface CallTile {
  key: string;
  kind: "participant" | "screen";
  participant: Participant;
  isLocal: boolean;
  imageUrl?: string;
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
  /** Move a remote participant's screen-share video + audio subscriptions to
   * "subscribed" so their stream actually starts flowing. */
  onSubscribeScreenShare?: (participantIdentity: string) => void;
  /** Move a remote participant's screen-share video + audio subscriptions
   * back to "unsubscribed" so bandwidth/decode stop being spent on it. */
  onUnsubscribeScreenShare?: (participantIdentity: string) => void;
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

const DEFAULT_SETTINGS: TileSettings = { volume: 1, muted: false };
const GAP = 8;

function TileWithContextMenu({
  tile,
  onClick,
  watchState,
  settings,
  onVolumeChange,
  onMuteToggle,
  moderation,
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
}) {
  const soundboardActive = useSoundboardActivity().has(
    tile.participant.identity,
  );
  const name = tile.participant.name || tile.participant.identity;
  const displayName = tile.kind === "screen" ? `${name}'s screen` : name;

  const inner =
    tile.kind === "screen" ? (
      <ScreenShareTile
        participant={tile.participant}
        isLocal={tile.isLocal}
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

/** How often (ms) to capture and stream a frame to the pip window. Modest
 * on purpose — it's a small preview window, not the primary view, and every
 * frame is a JPEG data URL sent over IPC. */
const PIP_FRAME_INTERVAL_MS = 1000 / 12;
/** Hard ceiling regardless of how big the user resizes the pip window to
 * (e.g. maximized on a large display) — keeps frame size/IPC bandwidth sane. */
const PIP_MAX_CAPTURE_WIDTH = 1920;

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
  const {
    isOpen: pipOpen,
    isSupported: pipSupported,
    size: pipSize,
    open: openPip,
    close: closePip,
    sendFrame,
  } = usePipWindow();
  const cameraHasVideo = useParticipantCameraFeed(tile.participant);
  const hasVideo = tile.kind === "screen" || cameraHasVideo;
  const pipSizeRef = useRef(pipSize);
  pipSizeRef.current = pipSize;

  // Reset zoom/pan whenever the focused tile changes (new participant/share)
  // and drop any open pop-out — it was showing the *previous* tile's stream.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    closePip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile.key]);

  // While popped out, the on-screen video is paused (frozen, and already
  // hidden behind the overlay below) so the main UI isn't still decoding and
  // painting a full-size copy nobody can see. A second, off-screen <video>
  // is attached to the same underlying LiveKit track purely to keep feeding
  // the capture loop — tracks support multiple simultaneous attachments, so
  // this doesn't disturb the tile's own attach/detach management. Captured
  // at the pip window's own (live, resize-aware) size — scaled for device
  // pixel ratio — rather than a fixed guess, since capturing smaller than
  // the window means the browser upscales a low-res JPEG to fill it.
  useEffect(() => {
    if (!pipOpen) return;
    const container = videoContainerRef.current;
    const visibleVideo = container?.querySelector("video") ?? null;
    visibleVideo?.pause();

    const source =
      tile.kind === "screen" ? Track.Source.ScreenShare : Track.Source.Camera;
    const track = tile.participant.getTrackPublication(source)?.track;

    const offscreen = document.createElement("video");
    offscreen.autoplay = true;
    offscreen.muted = true;
    offscreen.playsInline = true;
    Object.assign(offscreen.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
      top: "0",
      left: "0",
    });
    document.body.appendChild(offscreen);
    if (track) track.attach(offscreen);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let rafId: number;
    let lastSent = 0;

    const loop = (t: number) => {
      rafId = requestAnimationFrame(loop);
      if (!ctx || t - lastSent < PIP_FRAME_INTERVAL_MS) return;
      const video = offscreen;
      if (video.readyState < 2 || !video.videoWidth) return;
      lastSent = t;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.min(
        PIP_MAX_CAPTURE_WIDTH,
        Math.round(pipSizeRef.current.width * dpr),
      );
      // Never upscale past the source video's own resolution — pointless
      // and just makes the JPEG bigger for no visible gain.
      const w = Math.min(targetW, video.videoWidth);
      const h = Math.round(w * (video.videoHeight / video.videoWidth));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      sendFrame(canvas.toDataURL("image/jpeg", 0.85));
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      if (track) track.detach(offscreen);
      offscreen.remove();
      void visibleVideo?.play().catch(() => {});
    };
    // `tile` itself is a new object every render (constructed inline in
    // room-view.tsx); key/kind/participant identify it stably instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipOpen, tile.key, tile.kind, tile.participant, sendFrame]);

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!e.deltaY || pipOpen) return;
    e.preventDefault();
    setZoom((z) => clampZoom(z - e.deltaY * 0.0015));
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
    setPan((p) => ({ x: p.x + dx / zoom, y: p.y + dy / zoom }));
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
      closePip();
      return;
    }
    await openPip({ title: displayName, width: 480, height: 270 });
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
            onClick={closePip}
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
            onClick={() => setZoom((z) => clampZoom(z - 0.25))}
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
            onClick={() => setZoom((z) => clampZoom(z + 0.25))}
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
          {pipSupported && (
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
  getSettings: (identity: string) => TileSettings;
  onVolumeChange: (identity: string, v: number) => void;
  onMuteToggle: (identity: string) => void;
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
                        settings={getSettings(tile.participant.identity)}
                        onVolumeChange={(v) =>
                          onVolumeChange(tile.participant.identity, v)
                        }
                        onMuteToggle={() =>
                          onMuteToggle(tile.participant.identity)
                        }
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
  onSubscribeScreenShare,
  onUnsubscribeScreenShare,
  moderation,
}: CallGridProps) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());
  const [participantSettings, setParticipantSettings] = useState<
    Map<string, TileSettings>
  >(new Map());

  // Screen-share tile keys are `screen-${identity}` (see `RoomView`), so this
  // lets cleanup paths look up which participant to unsubscribe from even
  // after their tile has already disappeared from `tiles`.
  const screenTiles = tiles.filter((t) => t.kind === "screen");
  const identityForKey = (key: string) =>
    screenTiles.find((t) => t.key === key)?.participant.identity ??
    key.slice("screen-".length);

  useEffect(() => {
    if (focusedKey && !tiles.some((t) => t.key === focusedKey))
      setFocusedKey(null);
    const screenKeys = new Set(
      tiles.filter((t) => t.kind === "screen").map((t) => t.key),
    );
    setWatchedKeys((prev) => {
      const removed = [...prev].filter((k) => !screenKeys.has(k));
      if (removed.length === 0) return prev;
      // The tile disappeared (participant stopped sharing / left) — drop the
      // subscription too so a re-share later starts from the unwatched state.
      for (const key of removed)
        onUnsubscribeScreenShare?.(identityForKey(key));
      return new Set([...prev].filter((k) => screenKeys.has(k)));
    });
  }, [tiles, focusedKey, onUnsubscribeScreenShare]);

  const getWatchState = (tile: CallTile): WatchState | undefined => {
    if (tile.kind !== "screen" || tile.isLocal) return undefined;
    const identity = tile.participant.identity;
    const watching = watchedKeys.has(tile.key);
    const audioEnabled = watchedKeys.size === 0 || watching;
    const stopWatching = () => {
      setWatchedKeys((prev) => {
        const n = new Set(prev);
        n.delete(tile.key);
        return n;
      });
      onUnsubscribeScreenShare?.(identity);
    };
    const startWatching = (replace: boolean) => {
      setWatchedKeys((prev) => {
        if (!replace) return new Set([...prev, tile.key]);
        // "Watch" (not "Add") replaces the whole watch set — unsubscribe
        // whichever streams are being dropped so they stop downloading.
        for (const key of prev) {
          if (key !== tile.key) onUnsubscribeScreenShare?.(identityForKey(key));
        }
        return new Set([tile.key]);
      });
      onSubscribeScreenShare?.(identity);
    };
    return {
      watching,
      canWatch: true,
      audioEnabled,
      onWatch: watching ? stopWatching : () => startWatching(true),
      onWatchAdd:
        !watching && watchedKeys.size > 0
          ? () => startWatching(false)
          : undefined,
    };
  };

  const getSettings = (identity: string) =>
    participantSettings.get(identity) ?? DEFAULT_SETTINGS;

  const updateVolume = (identity: string, volume: number) =>
    setParticipantSettings((prev) => {
      const cur = prev.get(identity) ?? DEFAULT_SETTINGS;
      return new Map(prev).set(identity, { ...cur, volume });
    });

  const toggleMute = (identity: string) =>
    setParticipantSettings((prev) => {
      const cur = prev.get(identity) ?? DEFAULT_SETTINGS;
      return new Map(prev).set(identity, { ...cur, muted: !cur.muted });
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
      focused.participant.name || focused.participant.identity;
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
            settings={getSettings(focused.participant.identity)}
            onVolumeChange={(v) =>
              updateVolume(focused.participant.identity, v)
            }
            onMuteToggle={() => toggleMute(focused.participant.identity)}
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
                  onClick={() => setFocusedKey(tile.key)}
                  watchState={getWatchState(tile)}
                  settings={getSettings(tile.participant.identity)}
                  onVolumeChange={(v) =>
                    updateVolume(tile.participant.identity, v)
                  }
                  onMuteToggle={() => toggleMute(tile.participant.identity)}
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
