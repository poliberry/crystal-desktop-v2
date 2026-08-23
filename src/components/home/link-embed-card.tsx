"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";

interface LinkEmbedCardProps {
  url: string;
}

/**
 * The only hosts this app will put in an iframe.
 *
 * `embedUrl` is built server-side from a parsed resource id (see
 * convex/lib/richEmbeds.ts) rather than lifted out of a provider's oEmbed
 * HTML, so in practice it's always one of these. Checking anyway is what
 * makes that a guarantee instead of a convention: the value reaches here
 * through a database row, and a row is not something to take on trust.
 */
const EMBED_HOST_ALLOWLIST = [
  "https://www.youtube-nocookie.com/",
  "https://player.vimeo.com/",
  "https://open.spotify.com/embed/",
  "https://w.soundcloud.com/player/",
  "https://embed.music.apple.com/",
];

function framable(embedUrl: string | undefined): string | null {
  if (!embedUrl) return null;
  return EMBED_HOST_ALLOWLIST.some((prefix) => embedUrl.startsWith(prefix)) ? embedUrl : null;
}

/**
 * How long a failed unfurl is trusted before trying again.
 *
 * Failures are cached so a link with genuinely no metadata isn't re-fetched by
 * every client that renders the message — but caching them *forever* means one
 * bad moment (a provider rate-limiting us, a deploy landing mid-fetch) leaves a
 * URL permanently un-unfurlable, with nothing in the UI to suggest why.
 */
const ERROR_RETRY_MS = 60 * 60 * 1000;

const IFRAME_PERMISSIONS =
  "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture";

/** A video thumbnail that becomes the real player when clicked — the same
 * trade Discord makes, and the reason a channel full of links doesn't load a
 * dozen third-party players on sight. */
function VideoEmbed({
  embedUrl,
  aspect,
  image,
  title,
}: {
  embedUrl: string;
  aspect: number;
  image?: string;
  title?: string;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <iframe
        src={`${embedUrl}?autoplay=1`}
        title={title ?? "Embedded video"}
        allow={IFRAME_PERMISSIONS}
        allowFullScreen
        className="w-full rounded-md border bg-black"
        style={{ aspectRatio: aspect }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={title ? `Play ${title}` : "Play video"}
      className="group relative w-full overflow-hidden rounded-md border bg-black"
      style={{ aspectRatio: aspect }}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-black/70 text-white transition-transform group-hover:scale-110">
          <Play className="ml-0.5 size-6 fill-current" />
        </span>
      </span>
    </button>
  );
}

/** Provider metadata line: who made it, and where it lives. */
function EmbedHeader({
  siteName,
  faviconUrl,
  authorName,
  authorUrl,
}: {
  siteName?: string;
  faviconUrl?: string;
  authorName?: string;
  authorUrl?: string;
}) {
  if (!siteName && !authorName) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      {faviconUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={faviconUrl} alt="" referrerPolicy="no-referrer" className="size-3.5 shrink-0 rounded-sm" />
      )}
      {siteName && <span className="shrink-0 font-medium">{siteName}</span>}
      {authorName && (
        <>
          {siteName && <span aria-hidden>·</span>}
          {authorUrl ? (
            <a
              href={authorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate hover:underline"
            >
              {authorName}
            </a>
          ) : (
            <span className="truncate">{authorName}</span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The card under a message containing a link.
 *
 * Everything is unfurled once, server-side, and cached for every reader (see
 * convex/linkPreviews.ts) — the first client to see a new link is the one
 * that asks for it. What comes back decides the shape: a video gets a
 * click-to-play player, a track gets its provider's audio player inline, and
 * everything else gets the title/description/thumbnail card.
 */
export function LinkEmbedCard({ url }: LinkEmbedCardProps) {
  const preview = useQuery(api.linkPreviews.get, { url });
  const fetchAndCache = useAction(api.linkPreviews.fetchAndCache);
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (preview === undefined || triggeredRef.current) return;

    const stale =
      preview !== null &&
      (preview.status === "error"
        ? Date.now() - preview.fetchedAt > ERROR_RETRY_MS
        : // Unfurled before providers and players existed. A successful row
          // always carries a `kind`, so its absence dates the row rather than
          // describing the link.
          preview.kind === undefined);

    if (preview === null || stale) {
      triggeredRef.current = true;
      void fetchAndCache({ url });
    }
  }, [preview, url, fetchAndCache]);

  if (!preview || preview.status !== "ok") return null;

  const embedUrl = framable(preview.embedUrl);
  const hasText = !!(preview.title || preview.description);
  if (!embedUrl && !hasText && !preview.image) return null;

  // Discord's signature left edge, in the site's own colour where it
  // publishes one.
  const accent = preview.themeColor;

  if (embedUrl && preview.kind === "audio") {
    return (
      <div className="mt-1 max-w-md space-y-1">
        <EmbedHeader
          siteName={preview.siteName}
          faviconUrl={preview.faviconUrl}
          authorName={preview.authorName}
          authorUrl={preview.authorUrl}
        />
        <iframe
          src={embedUrl}
          title={preview.title ?? "Embedded player"}
          allow={IFRAME_PERMISSIONS}
          className="w-full rounded-md border"
          style={{ height: preview.embedHeight ?? 152 }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mt-1 max-w-md overflow-hidden rounded-md bg-muted/40",
        accent ? "border-l-4 border-y border-r" : "border"
      )}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      <div className="space-y-1.5 p-3">
        <EmbedHeader
          siteName={preview.siteName}
          faviconUrl={preview.faviconUrl}
          authorName={preview.authorName}
          authorUrl={preview.authorUrl}
        />

        {preview.title && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-semibold text-sky-400 hover:underline"
          >
            {preview.title}
          </a>
        )}
        {preview.description && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{preview.description}</p>
        )}

        {embedUrl ? (
          <VideoEmbed
            embedUrl={embedUrl}
            aspect={preview.embedAspect ?? 16 / 9}
            image={preview.image ?? undefined}
            title={preview.title ?? undefined}
          />
        ) : (
          preview.image && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.image}
                alt=""
                referrerPolicy="no-referrer"
                className="max-h-64 w-full rounded object-cover"
              />
            </a>
          )
        )}
      </div>
    </div>
  );
}
