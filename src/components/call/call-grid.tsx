"use client";

import { useEffect, useRef, useState } from "react";
import type { Participant } from "livekit-client";
import { Volume2, VolumeX } from "lucide-react";

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

export interface CallTile {
  key: string;
  kind: "participant" | "screen";
  participant: Participant;
  isLocal: boolean;
  imageUrl?: string;
}

interface CallGridProps {
  tiles: CallTile[];
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
}: {
  tile: CallTile;
  onClick: () => void;
  watchState?: WatchState;
  settings: TileSettings;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
}) {
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
            {settings.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            <span className="flex-1">Volume</span>
            <span className="tabular-nums">{Math.round(effectiveVolume * 100)}%</span>
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
            <><Volume2 className="mr-2 size-4" />Unmute for me</>
          ) : (
            <><VolumeX className="mr-2 size-4" />Mute for me</>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function GalleryGrid({
  tiles,
  onFocus,
  getWatchState,
  getSettings,
  onVolumeChange,
  onMuteToggle,
}: {
  tiles: CallTile[];
  onFocus: (key: string) => void;
  getWatchState: (tile: CallTile) => WatchState | undefined;
  getSettings: (identity: string) => TileSettings;
  onVolumeChange: (identity: string, v: number) => void;
  onMuteToggle: (identity: string) => void;
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

  const n = tiles.length;
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
    <div ref={containerRef} className="flex h-full w-full items-center justify-center overflow-hidden">
      <div className="flex flex-col items-center" style={{ gap: GAP }}>
        {Array.from({ length: rows }, (_, rowIndex) => {
          const rowTiles = tiles.slice(rowIndex * cols, (rowIndex + 1) * cols);
          return (
            <div key={rowIndex} className="flex" style={{ gap: GAP }}>
              {rowTiles.map((tile) => (
                <div
                  key={tile.key}
                  className="shrink-0 overflow-hidden rounded-lg"
                  style={{ width: tileW, height: tileH }}
                >
                  <TileWithContextMenu
                    tile={tile}
                    onClick={() => onFocus(tile.key)}
                    watchState={getWatchState(tile)}
                    settings={getSettings(tile.participant.identity)}
                    onVolumeChange={(v) => onVolumeChange(tile.participant.identity, v)}
                    onMuteToggle={() => onMuteToggle(tile.participant.identity)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CallGrid({
  tiles,
  onSubscribeScreenShare,
  onUnsubscribeScreenShare,
}: CallGridProps) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());
  const [participantSettings, setParticipantSettings] = useState<Map<string, TileSettings>>(new Map());

  // Screen-share tile keys are `screen-${identity}` (see `RoomView`), so this
  // lets cleanup paths look up which participant to unsubscribe from even
  // after their tile has already disappeared from `tiles`.
  const screenTiles = tiles.filter((t) => t.kind === "screen");
  const identityForKey = (key: string) =>
    screenTiles.find((t) => t.key === key)?.participant.identity ?? key.slice("screen-".length);

  useEffect(() => {
    if (focusedKey && !tiles.some((t) => t.key === focusedKey)) setFocusedKey(null);
    const screenKeys = new Set(tiles.filter((t) => t.kind === "screen").map((t) => t.key));
    setWatchedKeys((prev) => {
      const removed = [...prev].filter((k) => !screenKeys.has(k));
      if (removed.length === 0) return prev;
      // The tile disappeared (participant stopped sharing / left) — drop the
      // subscription too so a re-share later starts from the unwatched state.
      for (const key of removed) onUnsubscribeScreenShare?.(identityForKey(key));
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
        !watching && watchedKeys.size > 0 ? () => startWatching(false) : undefined,
    };
  };

  const getSettings = (identity: string) => participantSettings.get(identity) ?? DEFAULT_SETTINGS;

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
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="min-h-0 flex-1">
          <TileWithContextMenu
            tile={focused}
            onClick={() => setFocusedKey(null)}
            watchState={getWatchState(focused)}
            settings={getSettings(focused.participant.identity)}
            onVolumeChange={(v) => updateVolume(focused.participant.identity, v)}
            onMuteToggle={() => toggleMute(focused.participant.identity)}
          />
        </div>
        {rest.length > 0 && (
          <div className="flex h-28 shrink-0 justify-center gap-2 overflow-x-auto">
            {rest.map((tile) => (
              <div key={tile.key} className="h-full w-44 shrink-0">
                <TileWithContextMenu
                  tile={tile}
                  onClick={() => setFocusedKey(tile.key)}
                  watchState={getWatchState(tile)}
                  settings={getSettings(tile.participant.identity)}
                  onVolumeChange={(v) => updateVolume(tile.participant.identity, v)}
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
      onFocus={setFocusedKey}
      getWatchState={getWatchState}
      getSettings={getSettings}
      onVolumeChange={updateVolume}
      onMuteToggle={toggleMute}
    />
  );
}
