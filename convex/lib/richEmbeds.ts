/**
 * Provider-specific handling for link embeds.
 *
 * Most links are unfurled by scraping their OpenGraph tags, which gives a
 * title, a description and a picture — enough for a card, but not enough to
 * play anything. The handful of sites people actually paste constantly (a
 * YouTube video, a Spotify track) publish that information properly through
 * oEmbed *and* have a stable player URL, so those get recognised here and
 * come back with a canonical title, the uploader's name, and a player the
 * client can drop straight into an iframe.
 *
 * The player URL is always *built from the parsed id*, never taken from the
 * provider's oEmbed `html` field: that field is arbitrary markup from a third
 * party, and the client refuses to frame anything outside a fixed allow-list
 * of hosts (see src/components/home/link-embed-card.tsx) precisely because
 * this side promises never to produce anything else.
 */

/**
 * Bumped whenever this file changes what a stored preview should contain — a
 * new provider, a corrected player height, an extra field.
 *
 * Cached previews are keyed only by URL, so without this a fix here would only
 * ever apply to links nobody had pasted yet. The renderer compares the stamp
 * on a row against this and re-unfurls anything older, which turns "I changed
 * the unfurler" into "the change takes effect" without a migration.
 */
export const UNFURL_VERSION = 2;

/** What the card should do with an embed. */
export type EmbedKind = "link" | "video" | "audio";

export interface ProviderMatch {
  /** Stable key stored on the preview and matched by the renderer. */
  provider: string;
  kind: EmbedKind;
  /** Where to ask for canonical metadata, when the provider offers oEmbed. */
  oEmbedUrl?: string;
  /** In-place player, framed by the client. */
  embedUrl?: string;
  /** Player aspect ratio (width ÷ height). Video only. */
  embedAspect?: number;
  /** Fixed player height in pixels. Audio only — a track player has a
   * natural height rather than a natural shape. */
  embedHeight?: number;
}

function oEmbed(endpoint: string, url: string): string {
  return `${endpoint}?url=${encodeURIComponent(url)}&format=json`;
}

/** `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`. */
function youTubeId(parsed: URL): string | null {
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
  const match = parsed.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?]+)/);
  return match ? match[1] : null;
}

/** Ids are alphanumeric with `-` and `_` everywhere we build a URL from one;
 * anything else means we misparsed and shouldn't be constructing a player. */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/**
 * Recognise a URL, or `null` for the vast majority that just get scraped.
 */
export function matchProvider(url: string): ProviderMatch | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");

  const youtube = youTubeId(parsed);
  if (youtube && isSafeId(youtube)) {
    return {
      provider: "youtube",
      kind: "video",
      oEmbedUrl: oEmbed("https://www.youtube.com/oembed", url),
      // The `-nocookie` host is the same player without the tracking cookies,
      // which matters more here than on the web: this is a chat client, not
      // YouTube, and nobody pasted a link expecting to be followed around.
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtube}`,
      embedAspect: 16 / 9,
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parsed.pathname.match(/(\d+)/)?.[1];
    if (id) {
      return {
        provider: "vimeo",
        kind: "video",
        oEmbedUrl: oEmbed("https://vimeo.com/api/oembed.json", url),
        embedUrl: `https://player.vimeo.com/video/${id}`,
        embedAspect: 16 / 9,
      };
    }
  }

  if (host === "open.spotify.com") {
    const match = parsed.pathname.match(
      /^\/(?:intl-[a-z]+\/)?(track|album|playlist|artist|episode|show)\/([^/?]+)/
    );
    if (match && isSafeId(match[2])) {
      const [, type, id] = match;
      return {
        provider: "spotify",
        kind: "audio",
        oEmbedUrl: `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
        embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
        // Spotify draws one of two layouts and doesn't scale to the frame it's
        // given: a single-row player about 80px tall, or the full square one
        // at its documented 352. Anything in between (152, which their older
        // docs suggest) renders the row and leaves the rest of the iframe
        // empty. A track is the row; a playlist or album gets the full player,
        // since its track list is the whole point of embedding one.
        embedHeight: type === "track" || type === "episode" ? 80 : 352,
      };
    }
  }

  if (host === "soundcloud.com") {
    return {
      provider: "soundcloud",
      kind: "audio",
      oEmbedUrl: oEmbed("https://soundcloud.com/oembed", url),
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500`,
      embedHeight: 166,
    };
  }

  if (host === "music.apple.com") {
    return {
      provider: "apple-music",
      kind: "audio",
      // Apple's player is the same path on the embed host.
      embedUrl: `https://embed.music.apple.com${parsed.pathname}${parsed.search}`,
      embedHeight: parsed.searchParams.has("i") ? 175 : 450,
    };
  }

  // Recognised for the sake of labelling the card, but deliberately without a
  // player: Twitch's embed refuses to load unless the `parent` parameter
  // matches the embedding origin, which a desktop app can't promise.
  if (host === "twitch.tv" || host === "clips.twitch.tv") {
    return { provider: "twitch", kind: "link" };
  }

  return null;
}

export interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  provider_name?: string;
  width?: number;
  height?: number;
}

/** Fetch a provider's oEmbed document, or null if it isn't cooperating. */
export async function fetchOEmbed(oEmbedUrl: string): Promise<OEmbedResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(oEmbedUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return null;
    return (await response.json()) as OEmbedResponse;
  } catch {
    return null;
  }
}
