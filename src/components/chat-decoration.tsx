"use client";

import { useCachedBackgroundImage } from "@/lib/image-cache";
import { cn } from "@/lib/utils";

/**
 * The two things a room can be dressed in: a picture behind its messages, and
 * a banner strip under its header.
 *
 * One file for both channels and DMs, because they are the same two pictures
 * with the same two problems — legibility over the background, and a banner
 * that has to carry words over arbitrary artwork. Only who's allowed to set
 * them differs, and that's settled on the server.
 */

/** What a background sits at when nobody has chosen. Low, because the default
 * has to be safe for a photograph somebody uploaded without thinking about the
 * text that would end up on top of it. */
export const DEFAULT_BACKGROUND_OPACITY = 0.25;

/**
 * The picture behind a message list.
 *
 * `fixed`-style attachment via a non-scrolling absolutely positioned layer
 * rather than a `background-image` on the scroller: a background that scrolls
 * with the messages reads as a very long image sliding past, and re-rasterises
 * on every frame of a scroll.
 *
 * The scrim over it is not optional. Text over a photograph is unreadable at
 * any opacity that leaves the photograph worth having, so the picture is
 * turned down *and* covered — the opacity slider then only has to find a
 * pleasant amount rather than a legible one.
 */
export function ChatBackground({
  url,
  opacity = DEFAULT_BACKGROUND_OPACITY,
}: {
  url?: string;
  opacity?: number;
}) {
  // Inner component so the cache hook isn't called on every message list that
  // has no wallpaper — same "costs nothing when empty" shape as AvatarDecoration.
  if (!url) return null;
  return <ChatBackgroundLayer url={url} opacity={opacity} />;
}

function ChatBackgroundLayer({ url, opacity }: { url: string; opacity: number }) {
  const backgroundImage = useCachedBackgroundImage(url);
  return (
    // -z-10 inside an isolated parent: that paints the picture above the
    // column's own background colour but below every message in it, without
    // each of those needing a z-index of its own.
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage, opacity }}
      />
      {/* Darker towards the bottom, where the composer and the newest — most
          likely to be read — messages are. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/50 to-background/70" />
    </div>
  );
}

/**
 * The banner under a channel header: a faded picture with a heading and a line
 * of description over it.
 *
 * Distinct from the topic beside the channel name, which is a label. This is
 * an announcement — "read the rules", "event on Friday" — and is given the
 * room to say a sentence.
 *
 * Renders nothing at all when there's neither a picture nor any words, so an
 * unconfigured channel doesn't grow an empty strip.
 */
export function ChannelBanner({
  imageUrl,
  title,
  description,
  className,
}: {
  imageUrl?: string;
  title?: string;
  description?: string;
  className?: string;
}) {
  if (!imageUrl && !title && !description) return null;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border-b border-border/40",
        className,
      )}
    >
      {imageUrl && <ChannelBannerImage url={imageUrl} />}
      <div className="relative px-4 py-3">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function ChannelBannerImage({ url }: { url: string }) {
  const backgroundImage = useCachedBackgroundImage(url);
  return (
    <>
      <div aria-hidden className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage }} />
      {/* Faded, per the design: the picture is atmosphere and the words are the
          point. Left-weighted so the text side is the darker one whatever the
          artwork does. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/70 to-background/40"
      />
    </>
  );
}
