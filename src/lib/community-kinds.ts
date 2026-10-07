import {
  CalendarDays,
  ClipboardList,
  MessageCircleQuestion,
  MessagesSquare,
  Rss,
  Server,
  Swords,
  type LucideIcon,
} from "lucide-react";

import {
  CHANNEL_SURFACES,
  CREATOR_PLATFORMS,
  GAME_CATALOGUE,
  PLATFORM_META,
  SURFACE_META,
  type ChannelSurface,
  type ClanGame,
  type CreatorAudience,
} from "../../convex/lib/communityKinds";
import { type CommunitySetup, type SetupChannel, type SetupRole } from "@/lib/community-templates";
import { PERMISSIONS } from "@/lib/permissions";

export { CHANNEL_SURFACES, GAME_CATALOGUE, SURFACE_META };

/** The platforms, in the order the creator step lists them. */
export const CREATOR_PLATFORM_LIST = CREATOR_PLATFORMS.map((id) => ({ id, ...PLATFORM_META[id] }));
export type { ChannelSurface, ClanGame };

/** The icon for each special channel. */
export const SURFACE_ICONS: Record<ChannelSurface, LucideIcon> = {
  feed: Rss,
  calendar: CalendarDays,
  ama: MessageCircleQuestion,
  threads: MessagesSquare,
  servers: Server,
  lfg: Swords,
  roster: ClipboardList,
};

const MEMBER =
  PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.CONNECT | PERMISSIONS.CREATE_INVITE;

const MODERATOR =
  MEMBER |
  PERMISSIONS.MANAGE_MESSAGES |
  PERMISSIONS.KICK_MEMBERS |
  PERMISSIONS.MUTE_MEMBERS |
  PERMISSIONS.DEAFEN_MEMBERS |
  PERMISSIONS.MOVE_MEMBERS |
  PERMISSIONS.MODERATE_MEMBERS |
  PERMISSIONS.MENTION_EVERYONE;

const RULES = [
  { title: "Be respectful", body: "Treat everyone with kindness. No harassment, hate or personal attacks." },
  { title: "No spam or self-promotion", body: "Ask a moderator before sharing your own links." },
  { title: "Keep it safe for work", body: "No NSFW, graphic or illegal content." },
];

/** A clan: a hub, one corner per game, and the tools that go with them. */
export function clanSetup(games: ClanGame[]): CommunitySetup {
  const channels: SetupChannel[] = [
    { name: "announcements", type: "text", category: "Clan", topic: "News and plans" },
    { name: "general", type: "text", category: "Clan" },
    { name: "roster", type: "text", category: "Clan", surface: "roster", topic: "Who plays what" },
    { name: "looking-for-group", type: "text", category: "Clan", surface: "lfg", topic: "Find people to play with" },
    { name: "events", type: "text", category: "Clan", surface: "calendar", topic: "Scrims and get-togethers" },
    { name: "game-servers", type: "text", category: "Clan", surface: "servers", topic: "Start and watch the clan's servers" },
    { name: "Clan voice", type: "voice", category: "Clan" },
  ];
  for (const game of games) {
    channels.push(
      { name: `${game.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-chat`, type: "text", category: game.name, gameId: game.id },
      { name: `${game.name} lobby`, type: "voice", category: game.name, gameId: game.id },
    );
  }
  const roles: SetupRole[] = [
    { name: "Leader", color: "#ef4444", permissions: PERMISSIONS.ADMINISTRATOR, hoist: true },
    {
      name: "Officer",
      color: "#f59e0b",
      permissions: MODERATOR | PERMISSIONS.MANAGE_EVENTS | PERMISSIONS.MANAGE_GAME_SERVERS,
      hoist: true,
    },
    { name: "Member", color: "#22c55e", permissions: MEMBER, hoist: true },
    { name: "Recruit", color: "#94a3b8", permissions: MEMBER },
  ];
  return { channels, roles, rules: [...RULES, { title: "Show up", body: "Let the officers know if you can't make a scrim." }] };
}

/** A creator community: somewhere for the audience, with the channel tools that
 * suit it. A members-only community keeps its hangouts behind the same gate. */
export function creatorSetup(audience: CreatorAudience): CommunitySetup {
  void audience;
  const channels: SetupChannel[] = [
    { name: "announcements", type: "text", category: "Welcome", topic: "News from the channel" },
    { name: "newsfeed", type: "text", category: "Welcome", surface: "feed", topic: "Streams, VODs and uploads" },
    { name: "calendar", type: "text", category: "Welcome", surface: "calendar", topic: "What's coming up" },
    { name: "general", type: "text", category: "Community" },
    { name: "ask-me-anything", type: "text", category: "Community", surface: "ama", topic: "Ask, upvote, and get an answer" },
    { name: "community-threads", type: "text", category: "Community", surface: "threads", topic: "Longer conversations" },
    { name: "Hangout", type: "voice", category: "Voice" },
    { name: "Stream lounge", type: "voice", category: "Voice" },
  ];
  const roles: SetupRole[] = [
    { name: "Creator", color: "#ec4899", permissions: PERMISSIONS.ADMINISTRATOR, hoist: true },
    { name: "Moderator", color: "#3b82f6", permissions: MODERATOR | PERMISSIONS.MANAGE_EVENTS, hoist: true },
    { name: "Supporter", color: "#eab308", permissions: MEMBER, hoist: true },
  ];
  return { channels, roles, rules: RULES };
}
