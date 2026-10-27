/**
 * Twitch, YouTube and TikTok, behind one shape.
 *
 * Each platform has its own OAuth dance, its own idea of a "channel" and its own
 * way of saying who is a member. Everything platform-specific is here, so the
 * rest of Crystal asks the same four questions of any of them: who is this, what
 * have they put out lately, are they live, and what tier is this person.
 *
 * Nothing here runs without the deployment's own app credentials
 * (`TWITCH_CLIENT_ID`/`_SECRET`, `GOOGLE_CLIENT_ID`/`_SECRET`,
 * `TIKTOK_CLIENT_KEY`/`_SECRET`); `configured` says whether they are set, and a
 * platform that isn't is offered nowhere rather than failing on use.
 */

import type { CreatorPlatform } from "./communityKinds";

const TIMEOUT_MS = 10_000;

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  scopes: string[];
}

export interface PlatformProfile {
  externalId: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  /** The channel's address on the platform, where there is one. */
  url?: string;
}

export interface FeedEntry {
  externalId: string;
  kind: "live" | "vod" | "upload" | "short";
  title: string;
  thumbnailUrl?: string;
  url: string;
  durationSeconds?: number;
  views?: number;
  publishedAt: number;
}

export interface LiveState {
  isLive: boolean;
  title?: string;
  since?: number;
}

export interface Tier {
  key: string;
  name: string;
  rank: number;
}

export type Purpose = "channel" | "identity";

/** A request to a platform, with a timeout and a readable failure. */
async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      const error = new Error(`${new URL(url).hostname} answered ${res.status}`) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

const form = (data: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(data).toString(),
});

function env(name: string): string | undefined {
  return process.env[name];
}

// --- Twitch --------------------------------------------------------------------------------

const TWITCH_TIERS: Tier[] = [
  { key: "1000", name: "Tier 1", rank: 1 },
  { key: "2000", name: "Tier 2", rank: 2 },
  { key: "3000", name: "Tier 3", rank: 3 },
];

const twitchHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Client-Id": env("TWITCH_CLIENT_ID") ?? "" });

/** `1h2m3s` → seconds. */
function twitchDuration(text: string): number {
  const m = text.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return (Number(m?.[1] ?? 0) * 3600) + (Number(m?.[2] ?? 0) * 60) + Number(m?.[3] ?? 0);
}

const twitch = {
  configured: () => !!(env("TWITCH_CLIENT_ID") && env("TWITCH_CLIENT_SECRET")),
  authUrl(redirect: string, state: string, purpose: Purpose) {
    const scope = purpose === "channel" ? "channel:read:subscriptions" : "";
    const p = new URLSearchParams({ client_id: env("TWITCH_CLIENT_ID")!, redirect_uri: redirect, response_type: "code", state, ...(scope ? { scope } : {}) });
    return `https://id.twitch.tv/oauth2/authorize?${p}`;
  },
  async exchange(code: string, redirect: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string[] }>(
      "https://id.twitch.tv/oauth2/token",
      form({ client_id: env("TWITCH_CLIENT_ID")!, client_secret: env("TWITCH_CLIENT_SECRET")!, code, grant_type: "authorization_code", redirect_uri: redirect }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined, scopes: r.scope ?? [] };
  },
  async refresh(refreshToken: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string[] }>(
      "https://id.twitch.tv/oauth2/token",
      form({ client_id: env("TWITCH_CLIENT_ID")!, client_secret: env("TWITCH_CLIENT_SECRET")!, grant_type: "refresh_token", refresh_token: refreshToken }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? refreshToken, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined, scopes: r.scope ?? [] };
  },
  async profile(token: string): Promise<PlatformProfile> {
    const r = await call<{ data?: { id: string; login: string; display_name: string; profile_image_url?: string }[] }>("https://api.twitch.tv/helix/users", { headers: twitchHeaders(token) });
    const u = r.data?.[0];
    if (!u) throw new Error("Twitch didn't return an account.");
    return { externalId: u.id, displayName: u.display_name, handle: u.login, avatarUrl: u.profile_image_url, url: `https://twitch.tv/${u.login}` };
  },
  async feed(token: string, profile: PlatformProfile): Promise<{ items: FeedEntry[]; live: LiveState }> {
    const [videos, streams] = await Promise.all([
      call<{ data?: { id: string; title: string; thumbnail_url: string; url: string; duration: string; view_count: number; created_at: string; type: string }[] }>(
        `https://api.twitch.tv/helix/videos?user_id=${encodeURIComponent(profile.externalId)}&first=20&type=all`,
        { headers: twitchHeaders(token) },
      ),
      call<{ data?: { id: string; title: string; started_at: string; thumbnail_url: string }[] }>(
        `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(profile.externalId)}`,
        { headers: twitchHeaders(token) },
      ),
    ]);
    const items: FeedEntry[] = (videos.data ?? []).map((v) => ({
      externalId: `twitch:${v.id}`,
      kind: v.type === "archive" ? "vod" : "upload",
      title: v.title.slice(0, 140) || "Untitled",
      thumbnailUrl: v.thumbnail_url?.replace("%{width}", "480").replace("%{height}", "270") || undefined,
      url: v.url,
      durationSeconds: twitchDuration(v.duration),
      views: v.view_count,
      publishedAt: Date.parse(v.created_at),
    }));
    const s = streams.data?.[0];
    if (s) {
      items.unshift({
        externalId: `twitch:live:${s.id}`,
        kind: "live",
        title: s.title.slice(0, 140) || "Live now",
        thumbnailUrl: s.thumbnail_url?.replace("{width}", "480").replace("{height}", "270"),
        url: profile.url ?? "https://twitch.tv",
        publishedAt: Date.parse(s.started_at),
      });
    }
    return { items, live: s ? { isLive: true, title: s.title, since: Date.parse(s.started_at) } : { isLive: false } };
  },
  tiers: async (): Promise<Tier[]> => TWITCH_TIERS,
  /** What tier `memberExternalId` is, per the broadcaster's own token. */
  async tierOf(creatorToken: string, creator: PlatformProfile, memberExternalId: string): Promise<string | null> {
    try {
      const r = await call<{ data?: { tier: string }[] }>(
        `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${encodeURIComponent(creator.externalId)}&user_id=${encodeURIComponent(memberExternalId)}`,
        { headers: twitchHeaders(creatorToken) },
      );
      return r.data?.[0]?.tier ?? null;
    } catch (e) {
      // 404: not subscribed.
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
};

// --- YouTube -------------------------------------------------------------------------------

const GOOGLE_SCOPES = {
  identity: "https://www.googleapis.com/auth/youtube.readonly",
  channel: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.channel-memberships.creator",
};

/** ISO 8601 duration (`PT1H2M3S`) → seconds. */
function isoDuration(text: string): number {
  const m = text.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return Number(m?.[1] ?? 0) * 86400 + Number(m?.[2] ?? 0) * 3600 + Number(m?.[3] ?? 0) * 60 + Number(m?.[4] ?? 0);
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

const youtube = {
  configured: () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")),
  authUrl(redirect: string, state: string, purpose: Purpose) {
    const p = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID")!,
      redirect_uri: redirect,
      response_type: "code",
      scope: GOOGLE_SCOPES[purpose],
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },
  async exchange(code: string, redirect: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      "https://oauth2.googleapis.com/token",
      form({ client_id: env("GOOGLE_CLIENT_ID")!, client_secret: env("GOOGLE_CLIENT_SECRET")!, code, grant_type: "authorization_code", redirect_uri: redirect }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined, scopes: (r.scope ?? "").split(" ").filter(Boolean) };
  },
  async refresh(refreshToken: string): Promise<Tokens> {
    const r = await call<{ access_token: string; expires_in?: number; scope?: string }>(
      "https://oauth2.googleapis.com/token",
      form({ client_id: env("GOOGLE_CLIENT_ID")!, client_secret: env("GOOGLE_CLIENT_SECRET")!, grant_type: "refresh_token", refresh_token: refreshToken }),
    );
    return { accessToken: r.access_token, refreshToken, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined, scopes: (r.scope ?? "").split(" ").filter(Boolean) };
  },
  async profile(token: string): Promise<PlatformProfile> {
    const r = await call<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      bearer(token),
    );
    const c = r.items?.[0];
    if (!c) throw new Error("That Google account has no YouTube channel.");
    return {
      externalId: c.id,
      displayName: c.snippet.title,
      handle: c.snippet.customUrl,
      avatarUrl: c.snippet.thumbnails?.default?.url,
      url: c.snippet.customUrl ? `https://youtube.com/${c.snippet.customUrl}` : `https://youtube.com/channel/${c.id}`,
    };
  },
  async feed(token: string, profile: PlatformProfile): Promise<{ items: FeedEntry[]; live: LiveState }> {
    // Every channel's uploads are a playlist whose id is the channel's with a different prefix.
    const uploads = `UU${profile.externalId.slice(2)}`;
    const list = await call<{ items?: { contentDetails: { videoId: string } }[] }>(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=20&playlistId=${encodeURIComponent(uploads)}`,
      bearer(token),
    );
    const ids = (list.items ?? []).map((i) => i.contentDetails.videoId).filter(Boolean);
    if (ids.length === 0) return { items: [], live: { isLive: false } };
    const videos = await call<{
      items?: {
        id: string;
        snippet: { title: string; publishedAt: string; liveBroadcastContent?: string; thumbnails?: { medium?: { url: string } } };
        contentDetails?: { duration?: string };
        statistics?: { viewCount?: string };
        liveStreamingDetails?: { actualStartTime?: string };
      }[];
    }>(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${ids.join(",")}`, bearer(token));
    let live: LiveState = { isLive: false };
    const items: FeedEntry[] = (videos.items ?? []).map((v) => {
      const seconds = v.contentDetails?.duration ? isoDuration(v.contentDetails.duration) : undefined;
      const isLive = v.snippet.liveBroadcastContent === "live";
      if (isLive) live = { isLive: true, title: v.snippet.title, since: Date.parse(v.liveStreamingDetails?.actualStartTime ?? v.snippet.publishedAt) };
      return {
        externalId: `youtube:${v.id}`,
        kind: isLive ? "live" : v.liveStreamingDetails ? "vod" : seconds !== undefined && seconds <= 60 ? "short" : "upload",
        title: v.snippet.title.slice(0, 140),
        thumbnailUrl: v.snippet.thumbnails?.medium?.url,
        url: `https://youtube.com/watch?v=${v.id}`,
        durationSeconds: seconds,
        views: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
        publishedAt: Date.parse(v.snippet.publishedAt),
      };
    });
    return { items, live };
  },
  async tiers(token: string): Promise<Tier[]> {
    const r = await call<{ items?: { id: string; snippet?: { levelDetails?: { displayName?: string } } }[] }>(
      "https://www.googleapis.com/youtube/v3/membershipsLevels?part=snippet",
      bearer(token),
    );
    // The API lists levels lowest first.
    return (r.items ?? []).map((l, i) => ({ key: l.id, name: l.snippet?.levelDetails?.displayName ?? `Level ${i + 1}`, rank: i + 1 }));
  },
  async tierOf(creatorToken: string, _creator: PlatformProfile, memberExternalId: string): Promise<string | null> {
    const r = await call<{ items?: { snippet?: { membershipsDetails?: { highestAccessibleLevel?: string } } }[] }>(
      `https://www.googleapis.com/youtube/v3/members?part=snippet&mode=all_current&filterByMemberChannelId=${encodeURIComponent(memberExternalId)}`,
      bearer(creatorToken),
    );
    return r.items?.[0]?.snippet?.membershipsDetails?.highestAccessibleLevel ?? null;
  },
};

// --- TikTok --------------------------------------------------------------------------------

const tiktok = {
  configured: () => !!(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET")),
  authUrl(redirect: string, state: string, purpose: Purpose) {
    const p = new URLSearchParams({
      client_key: env("TIKTOK_CLIENT_KEY")!,
      scope: purpose === "channel" ? "user.info.basic,video.list" : "user.info.basic",
      response_type: "code",
      redirect_uri: redirect,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
  },
  async exchange(code: string, redirect: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      "https://open.tiktokapis.com/v2/oauth/token/",
      form({ client_key: env("TIKTOK_CLIENT_KEY")!, client_secret: env("TIKTOK_CLIENT_SECRET")!, code, grant_type: "authorization_code", redirect_uri: redirect }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined, scopes: (r.scope ?? "").split(",").filter(Boolean) };
  },
  async refresh(refreshToken: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      "https://open.tiktokapis.com/v2/oauth/token/",
      form({ client_key: env("TIKTOK_CLIENT_KEY")!, client_secret: env("TIKTOK_CLIENT_SECRET")!, grant_type: "refresh_token", refresh_token: refreshToken }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? refreshToken, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined, scopes: (r.scope ?? "").split(",").filter(Boolean) };
  },
  async profile(token: string): Promise<PlatformProfile> {
    const r = await call<{ data?: { user?: { open_id: string; display_name?: string; username?: string; avatar_url?: string } } }>(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username",
      bearer(token),
    );
    const u = r.data?.user;
    if (!u) throw new Error("TikTok didn't return an account.");
    return {
      externalId: u.open_id,
      displayName: u.display_name ?? u.username ?? "TikTok",
      handle: u.username,
      avatarUrl: u.avatar_url,
      url: u.username ? `https://tiktok.com/@${u.username}` : undefined,
    };
  },
  async feed(token: string): Promise<{ items: FeedEntry[]; live: LiveState }> {
    const r = await call<{ data?: { videos?: { id: string; title?: string; cover_image_url?: string; share_url?: string; duration?: number; view_count?: number; create_time: number }[] } }>(
      "https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url,share_url,duration,view_count,create_time",
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20 }) },
    );
    const items: FeedEntry[] = (r.data?.videos ?? [])
      .filter((v) => v.share_url)
      .map((v) => ({
        externalId: `tiktok:${v.id}`,
        kind: "short" as const,
        title: (v.title ?? "").slice(0, 140) || "TikTok",
        thumbnailUrl: v.cover_image_url,
        url: v.share_url!,
        durationSeconds: v.duration,
        views: v.view_count,
        publishedAt: v.create_time * 1000,
      }));
    // The public API doesn't say whether someone is live.
    return { items, live: { isLive: false } };
  },
  // TikTok has no memberships.
  tiers: async (): Promise<Tier[]> => [],
};

// --- The shape ---------------------------------------------------------------------------

export interface Platform {
  configured: () => boolean;
  authUrl: (redirect: string, state: string, purpose: Purpose) => string;
  exchange: (code: string, redirect: string) => Promise<Tokens>;
  refresh: (refreshToken: string) => Promise<Tokens>;
  profile: (token: string) => Promise<PlatformProfile>;
  feed: (token: string, profile: PlatformProfile) => Promise<{ items: FeedEntry[]; live: LiveState }>;
  tiers: (token: string) => Promise<Tier[]>;
  tierOf?: (creatorToken: string, creator: PlatformProfile, memberExternalId: string) => Promise<string | null>;
}

export const PLATFORMS: Record<CreatorPlatform, Platform> = { twitch, youtube, tiktok };

/** The environment variables each platform needs, so a missing one can be named. */
const REQUIRED_ENV: Record<CreatorPlatform, string[]> = {
  twitch: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
};

/** Which of a platform's variables are not set on this deployment. */
export function missingEnv(platform: CreatorPlatform): string[] {
  return REQUIRED_ENV[platform].filter((name) => !env(name));
}

/** The platforms this deployment has credentials for. */
export function configuredPlatforms(): CreatorPlatform[] {
  return (Object.keys(PLATFORMS) as CreatorPlatform[]).filter((p) => PLATFORMS[p].configured());
}
