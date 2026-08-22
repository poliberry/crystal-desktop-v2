"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * A placeholder for someone who belongs to a DM or group call but hasn't
 * joined yet.
 *
 * Occupies the same footprint as a real participant tile so the grid doesn't
 * reflow when they answer — the pulse just stops and the card is swapped for
 * their actual tile.
 */
export function PendingParticipantTile({
  name,
  imageUrl,
  ringing,
  fill = false,
}: {
  name: string;
  imageUrl?: string;
  /** True while they're actually being rung; false once the ring lapsed, so
   * a missed call settles into a quiet placeholder rather than pulsing on. */
  ringing: boolean;
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden rounded-lg",
        "border border-dashed border-border/60 bg-muted/20",
        fill ? "h-full" : "aspect-video"
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <span className="relative flex">
          {ringing && (
            <span className="absolute inset-0 animate-ping rounded-full bg-foreground/20" />
          )}
          <Avatar className={cn("relative size-15", ringing && "animate-pulse")}>
            <AvatarImage src={imageUrl} alt={name} />
            <AvatarFallback className="text-2xl font-semibold">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-medium text-white drop-shadow">{name}</span>
        <span className="shrink-0 text-xs text-white/80">{ringing ? "Ringing…" : "Not in call"}</span>
      </div>
    </div>
  );
}
