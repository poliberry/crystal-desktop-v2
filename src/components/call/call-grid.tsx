"use client";

import { useEffect, useState } from "react";
import type { Participant } from "livekit-client";

import { ParticipantTile } from "@/components/participant-tile";
import { ScreenShareTile } from "@/components/screen-share-tile";

export interface CallTile {
  key: string;
  kind: "participant" | "screen";
  participant: Participant;
  isLocal: boolean;
}

interface CallGridProps {
  tiles: CallTile[];
}

/**
 * Row sizes for a Zoom/Meet-style gallery layout: 1 participant gets one big
 * card, 2 get a vertical stack, 3 get two cards on top and one full-width
 * underneath, and beyond that it settles into a near-square grid whose last
 * row (if uneven) stretches to fill the width rather than leaving a gap.
 */
function computeRows(n: number): number[] {
  if (n <= 1) return [Math.max(n, 1)];
  if (n === 2) return [1, 1];
  if (n === 3) return [2, 1];

  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const result: number[] = [];
  let remaining = n;
  for (let i = 0; i < rows; i++) {
    const remainingRows = rows - i;
    const take = Math.ceil(remaining / remainingRows);
    result.push(take);
    remaining -= take;
  }
  return result;
}

function Tile({ tile, onClick }: { tile: CallTile; onClick: () => void }) {
  if (tile.kind === "screen") {
    // Screen shares keep a 16:9 box instead of stretching to fill whatever
    // shape the dynamic grid's cell happens to be — centered/letterboxed
    // within the available space rather than distorted.
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ScreenShareTile participant={tile.participant} isLocal={tile.isLocal} onClick={onClick} />
      </div>
    );
  }
  return <ParticipantTile participant={tile.participant} isLocal={tile.isLocal} fill onClick={onClick} />;
}

/** The call's main video area: a dynamic gallery grid when nothing is
 * focused, or a large focused tile with everyone else in a scrollable
 * bottom rail once one is clicked. Clicking the focused tile (or a rail
 * tile) toggles/switches focus. */
export function CallGrid({ tiles }: CallGridProps) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  useEffect(() => {
    if (focusedKey && !tiles.some((t) => t.key === focusedKey)) {
      setFocusedKey(null);
    }
  }, [tiles, focusedKey]);

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
          <Tile tile={focused} onClick={() => setFocusedKey(null)} />
        </div>
        {rest.length > 0 && (
          <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
            {rest.map((tile) => (
              <div key={tile.key} className="h-full w-44 shrink-0">
                <Tile tile={tile} onClick={() => setFocusedKey(tile.key)} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const rows = computeRows(tiles.length);
  let cursor = 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {rows.map((count, rowIndex) => {
        const rowTiles = tiles.slice(cursor, cursor + count);
        cursor += count;
        return (
          <div key={rowIndex} className="flex min-h-0 flex-1 gap-2">
            {rowTiles.map((tile) => (
              <div key={tile.key} className="min-w-0 flex-1">
                <Tile tile={tile} onClick={() => setFocusedKey(tile.key)} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
