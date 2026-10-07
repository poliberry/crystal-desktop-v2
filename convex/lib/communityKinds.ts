/**
 * Community kinds, and the special channels they bring.
 *
 * Pure data, imported by the server (to check what a client sent) and by the
 * client (to draw it), so the two cannot disagree about what exists.
 *
 * A *kind* is a capability set, not a fork of the app: a standard community has
 * none of these, a creator community is centred on a platform channel, and a clan
 * is centred on up to five games. A *surface* is what a special channel shows in
 * place of a message list. It is a flag on a text channel rather than a new
 * channel type — the same call the lounge made on a voice channel — so a feed or
 * a calendar still has permissions, a place in the sidebar and an unread dot, and
 * nothing that lists channels has to learn a third type.
 */

export const COMMUNITY_KINDS = ["creator", "clan"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const CHANNEL_SURFACES = [
  /** A creator's recent streams, VODs and uploads. */
  "feed",
  /** Scheduled streams, events and scrims. */
  "calendar",
  /** Members ask, the creator answers one at a time. */
  "ama",
  /** A forum: every post is a thread of its own. */
  "threads",
  /** Game servers, operated through Pterodactyl. */
  "servers",
  /** Looking-for-group posts, per game. */
  "lfg",
  /** Who plays what, and at what rank. */
  "roster",
] as const;
export type ChannelSurface = (typeof CHANNEL_SURFACES)[number];

/** What each surface is called and says about itself, for the pickers. */
export const SURFACE_META: Record<ChannelSurface, { label: string; blurb: string; kinds: CommunityKind[] | "any" }> = {
  feed: { label: "Newsfeed", blurb: "Recent streams, VODs and uploads from your channel.", kinds: ["creator"] },
  calendar: { label: "Calendar", blurb: "Streams, events and scrims, with sign-ups.", kinds: "any" },
  ama: { label: "AMA", blurb: "Members ask; you answer one question at a time.", kinds: ["creator"] },
  threads: { label: "Threads", blurb: "A forum — every post is a conversation of its own.", kinds: "any" },
  servers: { label: "Game servers", blurb: "Start, stop and watch your Pterodactyl servers.", kinds: "any" },
  lfg: { label: "Looking for group", blurb: "Find people to play with, per game.", kinds: ["clan"] },
  roster: { label: "Roster", blurb: "Who plays what, and at what rank.", kinds: ["clan"] },
};

/** Whether a kind of community may have a given surface. */
export function surfaceAllowed(kind: CommunityKind | undefined, surface: ChannelSurface): boolean {
  const allowed = SURFACE_META[surface].kinds;
  if (allowed === "any") return kind !== undefined;
  return kind !== undefined && allowed.includes(kind);
}

// --- Clans -----------------------------------------------------------------------------

export const MAX_CLAN_GAMES = 5;

export interface ClanGame {
  /** A slug: `valorant`, or `custom-minecraft-bedwars` for one typed in. */
  id: string;
  name: string;
}

/** Games offered as a starting list. A clan can also type its own. */
export const GAME_CATALOGUE: ClanGame[] = [
  { id: "valorant", name: "VALORANT" },
  { id: "league-of-legends", name: "League of Legends" },
  { id: "counter-strike-2", name: "Counter-Strike 2" },
  { id: "apex-legends", name: "Apex Legends" },
  { id: "fortnite", name: "Fortnite" },
  { id: "overwatch-2", name: "Overwatch 2" },
  { id: "rocket-league", name: "Rocket League" },
  { id: "minecraft", name: "Minecraft" },
  { id: "rust", name: "Rust" },
  { id: "dota-2", name: "Dota 2" },
  { id: "destiny-2", name: "Destiny 2" },
  { id: "call-of-duty", name: "Call of Duty" },
  { id: "rainbow-six-siege", name: "Rainbow Six Siege" },
  { id: "world-of-warcraft", name: "World of Warcraft" },
  { id: "final-fantasy-xiv", name: "Final Fantasy XIV" },
  { id: "ark-survival", name: "ARK: Survival" },
  { id: "palworld", name: "Palworld" },
  { id: "satisfactory", name: "Satisfactory" },
  { id: "valheim", name: "Valheim" },
  { id: "terraria", name: "Terraria" },
];

/** A game's id from its name. */
export function slugifyGame(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

/** A clan's games, rebuilt: trimmed, de-duplicated, capped at five. Throws if
 * there are none, because a clan with no game is just a community. */
export function sanitizeClanGames(input: { id?: string; name: string }[]): ClanGame[] {
  const seen = new Set<string>();
  const games: ClanGame[] = [];
  for (const raw of input) {
    const name = raw.name.trim().slice(0, 40);
    if (!name) continue;
    const known = GAME_CATALOGUE.find((g) => g.id === raw.id);
    const id = known ? known.id : `custom-${slugifyGame(name) || "game"}`;
    if (seen.has(id)) continue;
    seen.add(id);
    games.push({ id, name: known ? known.name : name });
  }
  if (games.length === 0) throw new Error("A clan is centred on at least one game.");
  if (games.length > MAX_CLAN_GAMES) throw new Error(`A clan is centred on up to ${MAX_CLAN_GAMES} games.`);
  return games;
}

// --- Creator communities ---------------------------------------------------------------

export const CREATOR_PLATFORMS = ["twitch", "youtube", "tiktok"] as const;
export type CreatorPlatform = (typeof CREATOR_PLATFORMS)[number];

export const PLATFORM_META: Record<CreatorPlatform, { label: string; supportsTiers: boolean; tierNoun: string }> = {
  twitch: { label: "Twitch", supportsTiers: true, tierNoun: "subscriber tiers" },
  youtube: { label: "YouTube", supportsTiers: true, tierNoun: "channel memberships" },
  // TikTok has no membership API, so a TikTok community has no tiers to import.
  tiktok: { label: "TikTok", supportsTiers: false, tierNoun: "" },
};

export const CREATOR_AUDIENCES = ["public", "members"] as const;
export type CreatorAudience = (typeof CREATOR_AUDIENCES)[number];
