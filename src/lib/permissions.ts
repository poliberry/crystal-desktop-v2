import { bitsHas, bitsOr, bitsWithout } from "../../convex/lib/permissionBits";
import { PERMISSIONS } from "../../convex/lib/permissionFlags";

export { bitsHas, bitsOr, bitsWithout };

/**
 * Client-side view of convex/permissions.ts's bitfield — used only for
 * rendering (checkboxes, gating which buttons show). The server re-checks
 * everything independently; nothing here is authoritative.
 *
 * Flags above bit 30 don't survive `&` / `|`, so anything that may touch one
 * uses `bitsHas` / `bitsOr` / `bitsWithout`.
 */
export { PERMISSIONS };

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  VIEW_CHANNELS: "View channels",
  SEND_MESSAGES: "Send messages",
  MANAGE_MESSAGES: "Manage messages",
  CONNECT: "Connect to voice",
  MANAGE_CHANNELS: "Manage channels",
  MANAGE_ROLES: "Manage roles",
  MANAGE_COMMUNITY: "Manage community",
  KICK_MEMBERS: "Kick members",
  ADMINISTRATOR: "Administrator (bypasses all other checks)",
  CREATE_INVITE: "Create invite codes",
  MANAGE_EMOJIS: "Manage emojis, stickers, and soundboard",
  MUTE_MEMBERS: "Server-mute members in voice",
  DEAFEN_MEMBERS: "Server-deafen members in voice",
  MOVE_MEMBERS: "Disconnect members from voice",
  BAN_MEMBERS: "Ban members",
  MODERATE_MEMBERS: "Time members out",
  MANAGE_NICKNAMES: "Change members' nicknames",
  MENTION_EVERYONE: "Mention @everyone, @here and roles",
  MANAGE_GAME_SERVERS: "Manage game servers",
  MANAGE_EVENTS: "Manage events",
  MANAGE_INTEGRATIONS: "Manage bots and integrations",
  CHANGE_NICKNAME: "Change own nickname",
  CREATE_EXPRESSIONS: "Create emojis, stickers and soundboard clips",
  CREATE_EVENTS: "Create events",
  EMBED_LINKS: "Embed links",
  ATTACH_FILES: "Attach files",
  ADD_REACTIONS: "Add reactions",
  USE_EXTERNAL_EMOJIS: "Use external emojis",
  READ_MESSAGE_HISTORY: "Read message history",
  PIN_MESSAGES: "Pin messages",
  USE_APPLICATION_COMMANDS: "Use bot commands",
  SPEAK: "Speak",
  VIDEO: "Video and screen share",
  USE_SOUNDBOARD: "Use soundboard",
  USE_EXTERNAL_SOUNDS: "Use external sounds",
  USE_VAD: "Use voice activity detection",
  PRIORITY_SPEAKER: "Priority speaker",
  SET_VOICE_STATUS: "Set voice channel status",
  REQUEST_TO_SPEAK: "Request to speak",
  USE_EMBEDDED_ACTIVITIES: "Use activities",
  CREATE_PUBLIC_THREADS: "Create threads and posts",
  CREATE_PRIVATE_THREADS: "Create private threads",
  SEND_MESSAGES_IN_THREADS: "Reply in threads and posts",
  MANAGE_THREADS: "Manage threads and posts",
  USE_EXTERNAL_STICKERS: "Use external stickers",
  SEND_TTS: "Send text-to-speech messages",
  SEND_VOICE_MESSAGES: "Send voice messages",
  CREATE_POLLS: "Create polls",
  BYPASS_SLOWMODE: "Bypass slowmode",
  VIEW_AUDIT_LOG: "View audit log",
  VIEW_INSIGHTS: "View community insights",
  VIEW_CREATOR_MONETIZATION: "View creator earnings",
} as const;

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  VIEW_CHANNELS: "Allows holders of this role to view channels in your community.",
  SEND_MESSAGES: "Allows users to send messages in your community.",
  MANAGE_MESSAGES: "Allows users to manage messages in your community, such as deleting or pinning them.",
  CONNECT: "Allow users to join Voice and Lounge channels in your community.",
  MANAGE_CHANNELS: "Allows users to manage channels in your community.",
  MANAGE_ROLES: "Allows users to manage roles in your community.",
  MANAGE_COMMUNITY:
    "Allows users to change the community's name, icon, banner and other settings.",
  KICK_MEMBERS:
    "Allows users to remove members from the community. Kicked members can rejoin with a new invite.",
  ADMINISTRATOR:
    "Grants every permission and bypasses channel-specific permissions. This is a dangerous permission to give out.",
  CREATE_INVITE: "Allows users to invite new people to this community.",
  MANAGE_EMOJIS:
    "Allows users to add and remove custom emojis and soundboard clips in this community.",
  MUTE_MEMBERS: "Allows users to mute other members in voice channels for everyone.",
  DEAFEN_MEMBERS: "Allows users to deafen other members in voice channels.",
  MOVE_MEMBERS: "Allows users to disconnect other members from voice channels.",
  BAN_MEMBERS:
    "Allows users to permanently ban members from the community. Banned members can't rejoin.",
  MODERATE_MEMBERS:
    "Allows users to time members out, so they stay in the community but can't send messages or talk.",
  MANAGE_NICKNAMES: "Allows users to change the nicknames of other members.",
  MENTION_EVERYONE:
    "Allows users to use @everyone and @here, and to mention any role in your community.",
  MANAGE_GAME_SERVERS:
    "Allows users to connect a Pterodactyl panel and choose who can start, stop and use each game server.",
  MANAGE_EVENTS: "Allows users to create, edit and cancel events and scrims.",
  MANAGE_INTEGRATIONS:
    "Allows users to add bots to your community, choose what each may do (never more than they can do themselves), and remove them.",
  CHANGE_NICKNAME: "Allows users to change their own nickname in this community.",
  CREATE_EXPRESSIONS:
    "Allows users to add custom emojis, stickers and soundboard clips. Removing other people's still takes Manage emojis.",
  CREATE_EVENTS: "Allows users to create events and scrims. Editing and cancelling anyone's still takes Manage events.",
  EMBED_LINKS: "Allows links that users post to show a preview.",
  ATTACH_FILES: "Allows users to upload files and images.",
  ADD_REACTIONS: "Allows users to add new reactions to a message. They can still react with one that is already there.",
  USE_EXTERNAL_EMOJIS: "Allows users to use custom emojis from other communities.",
  READ_MESSAGE_HISTORY: "Allows users to read messages sent before they opened the channel.",
  PIN_MESSAGES: "Allows users to pin and unpin messages. Manage messages does this too.",
  USE_APPLICATION_COMMANDS: "Allows users to use bot commands and press bot buttons.",
  SPEAK: "Allows users to talk in voice channels.",
  VIDEO: "Allows users to turn on their camera and share their screen in voice channels.",
  USE_SOUNDBOARD: "Allows users to play soundboard clips in voice channels.",
  USE_EXTERNAL_SOUNDS: "Allows users to play soundboard clips from other communities.",
  USE_VAD: "Allows users to speak by voice activity. Without it they have to use push-to-talk.",
  PRIORITY_SPEAKER: "Allows users to be heard more clearly over others in a voice channel.",
  SET_VOICE_STATUS: "Allows users to set the status line shown under a voice channel's name.",
  REQUEST_TO_SPEAK: "Allows users to ask to speak in a stage channel.",
  USE_EMBEDDED_ACTIVITIES: "Allows users to start activities in a voice channel.",
  CREATE_PUBLIC_THREADS: "Allows users to start threads and forum posts that everyone who can see the channel can read.",
  CREATE_PRIVATE_THREADS: "Allows users to start threads that only invited people can see.",
  SEND_MESSAGES_IN_THREADS: "Allows users to reply in threads and forum posts.",
  MANAGE_THREADS: "Allows users to lock, archive and delete threads and forum posts. Manage messages does this too.",
  USE_EXTERNAL_STICKERS: "Allows users to use stickers from other communities.",
  SEND_TTS: "Allows users to send text-to-speech messages.",
  SEND_VOICE_MESSAGES: "Allows users to send voice messages.",
  CREATE_POLLS: "Allows users to create polls.",
  BYPASS_SLOWMODE: "Allows users to send messages without waiting out a channel's slowmode.",
  VIEW_AUDIT_LOG: "Allows users to see the log of changes made to this community.",
  VIEW_INSIGHTS: "Allows users to see this community's growth and engagement numbers.",
  VIEW_CREATOR_MONETIZATION: "Allows users to see a creator community's earnings and subscriber numbers.",
} as const;

/** The permissions that act inside a text channel, in the order shown — for roles and for channel overwrites. */
export const TEXT_PERMISSION_KEYS: PermissionKey[] = [
  "SEND_MESSAGES",
  "SEND_MESSAGES_IN_THREADS",
  "CREATE_PUBLIC_THREADS",
  "CREATE_PRIVATE_THREADS",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "USE_EXTERNAL_STICKERS",
  "MENTION_EVERYONE",
  "MANAGE_MESSAGES",
  "PIN_MESSAGES",
  "MANAGE_THREADS",
  "READ_MESSAGE_HISTORY",
  "SEND_TTS",
  "USE_APPLICATION_COMMANDS",
  "SEND_VOICE_MESSAGES",
  "CREATE_POLLS",
  "BYPASS_SLOWMODE",
];

/** The permissions that act inside a voice channel, in the order shown. */
export const VOICE_PERMISSION_KEYS: PermissionKey[] = [
  "CONNECT",
  "SPEAK",
  "VIDEO",
  "USE_SOUNDBOARD",
  "USE_EXTERNAL_SOUNDS",
  "USE_EMBEDDED_ACTIVITIES",
  "USE_VAD",
  "PRIORITY_SPEAKER",
  "SET_VOICE_STATUS",
  "REQUEST_TO_SPEAK",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
];

/**
 * Permissions that exist so the set matches Discord's, for things Crystal doesn't have or can't
 * check. They can be given and taken away like any other, and are stored, but nothing checks them.
 * The editors say so rather than let a switch look like it does something.
 * Currently empty: USE_VAD, PRIORITY_SPEAKER, SET_VOICE_STATUS, REQUEST_TO_SPEAK,
 * USE_EMBEDDED_ACTIVITIES, USE_EXTERNAL_SOUNDS, VIEW_INSIGHTS and VIEW_CREATOR_MONETIZATION are
 * all server-enforced (see voice/admin rework), so they were removed from this set.
 */
export const UNENFORCED_PERMISSIONS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([]);

/**
 * How the permission list is broken up in the role editor, in the order shown.
 *
 * A key belongs to exactly one group. Anything added to `PERMISSIONS` without
 * a home here would silently vanish from the editor, so the tab collects
 * whatever is left over into a trailing group rather than dropping it.
 */
export const PERMISSION_GROUPS: { title: string; keys: PermissionKey[] }[] = [
  {
    title: "General Server Permissions",
    keys: [
      "VIEW_CHANNELS",
      "MANAGE_CHANNELS",
      "MANAGE_ROLES",
      "MANAGE_EMOJIS",
      "MANAGE_COMMUNITY",
      "CREATE_INVITE",
      "MANAGE_NICKNAMES",
      "MANAGE_EVENTS",
      "MANAGE_GAME_SERVERS",
      "MANAGE_INTEGRATIONS",
      "CREATE_EXPRESSIONS",
      "CREATE_EVENTS",
      "CHANGE_NICKNAME",
      "VIEW_AUDIT_LOG",
      "VIEW_INSIGHTS",
      "VIEW_CREATOR_MONETIZATION",
    ],
  },
  {
    title: "Membership Permissions",
    keys: ["KICK_MEMBERS", "BAN_MEMBERS", "MODERATE_MEMBERS"],
  },
  {
    title: "Text Channel Permissions",
    keys: [...TEXT_PERMISSION_KEYS],
  },
  {
    title: "Voice Channel Permissions",
    keys: [...VOICE_PERMISSION_KEYS],
  },
  {
    title: "Advanced Permissions",
    keys: ["ADMINISTRATOR"],
  },
];

export function hasPermission(permissions: number, flag: number): boolean {
  return bitsHas(permissions, PERMISSIONS.ADMINISTRATOR) || bitsHas(permissions, flag);
}
