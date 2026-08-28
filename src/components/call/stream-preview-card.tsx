"use client";

import { Play, ScreenShare } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * The picture of a live screen share, plus a line saying whose it is.
 *
 * The still is published by the sharer's own client every few seconds (see
 * useStreamThumbnail) because a stream can't be sampled without subscribing to
 * it — which is the very cost this exists to let you avoid. When there isn't
 * one yet, `fallback` stands in rather than an empty box.
 *
 * Shared with the rich presence card, which renders a stream as one more
 * activity: same picture, its own card shell.
 */
export function StreamBody({
  label,
  thumbnailUrl,
  fallback,
  watchable = false,
}: {
  label: string;
  thumbnailUrl?: string;
  fallback?: React.ReactNode;
  /** Draws the hover overlay. The click itself belongs to whatever wraps
   * this — see StreamPreviewCard. */
  watchable?: boolean;
}) {
  return (
    <>
      {/* `min-w-0`: the still inside is a replaced element, so without it this
          box's min-content width is the thumbnail's own pixel width — 1280 of
          them — and every container up to the profile card is sized to fit a
          picture that is being scaled down anyway. */}
      <div className="relative aspect-video w-full min-w-0 overflow-hidden rounded bg-black">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt={label} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">{fallback}</div>
        )}

        <span className="absolute top-1 left-1 rounded-[3px] bg-destructive px-1 text-[9px] font-bold leading-[14px] tracking-wide text-white">
          LIVE
        </span>

        {watchable && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/stream:opacity-100">
            <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
              <Play className="size-3.5 fill-current" />
              Join &amp; watch
            </span>
          </span>
        )}
      </div>

      <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        <ScreenShare className="size-3.5 shrink-0 text-destructive" />
        <span className="truncate">{label}</span>
      </p>
    </>
  );
}

/**
 * A live screen share as seen from outside the call, in its own card.
 *
 * Shaped like the rich presence cards so a stream sits alongside "Playing …"
 * and "Listening to …" as one more thing someone is doing.
 */
export function StreamPreviewCard({
  name,
  imageUrl,
  thumbnailUrl,
  onWatch,
  className,
}: {
  name: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  /** Omitted where there's nothing to click through to (already in the call,
   * or a context without navigation). */
  onWatch?: () => void;
  className?: string;
}) {
  const body = (
    <StreamBody
      label={`${name} is streaming`}
      thumbnailUrl={thumbnailUrl}
      watchable={!!onWatch}
      fallback={
        <Avatar className="size-10 opacity-60">
          <AvatarImage src={imageUrl} alt={name} />
          <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      }
    />
  );

  const shell = cn(
    "group/stream rounded-md border border-border/40 bg-muted/30 p-2",
    onWatch && "cursor-pointer text-left transition-colors hover:bg-muted/50",
    className
  );

  if (!onWatch) return <div className={shell}>{body}</div>;

  return (
    <button type="button" onClick={onWatch} className={cn(shell, "w-full")}>
      {body}
    </button>
  );
}
