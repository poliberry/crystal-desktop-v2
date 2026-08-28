/**
 * Client-side mirror of convex/permissions.ts's bitfield — used only for
 * rendering (checkboxes, gating which buttons show). The server re-checks
 * everything independently; nothing here is authoritative.
 */
export const PERMISSIONS = {
  VIEW_CHANNELS: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  CONNECT: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_ROLES: 1 << 5,
  MANAGE_COMMUNITY: 1 << 6,
  KICK_MEMBERS: 1 << 7,
  ADMINISTRATOR: 1 << 8,
  CREATE_INVITE: 1 << 9,
  MANAGE_EMOJIS: 1 << 10,
  /** Server-mute a member in voice. */
  MUTE_MEMBERS: 1 << 11,
  /** Server-deafen a member in voice. */
  DEAFEN_MEMBERS: 1 << 12,
  /** Disconnect a member from voice. */
  MOVE_MEMBERS: 1 << 13,
  BAN_MEMBERS: 1 << 14,
  /** Time a member out — they stay in the server but can't talk. */
  MODERATE_MEMBERS: 1 << 15,
  MANAGE_NICKNAMES: 1 << 16,
  MENTION_EVERYONE: 1 << 17,
} as const;

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
} as const;

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
    ],
  },
  {
    title: "Membership Permissions",
    keys: ["KICK_MEMBERS", "BAN_MEMBERS", "MODERATE_MEMBERS"],
  },
  {
    title: "Text Channel Permissions",
    keys: ["SEND_MESSAGES", "MANAGE_MESSAGES", "MENTION_EVERYONE"],
  },
  {
    title: "Voice Channel Permissions",
    keys: ["CONNECT", "MUTE_MEMBERS", "DEAFEN_MEMBERS", "MOVE_MEMBERS"],
  },
  {
    title: "Advanced Permissions",
    keys: ["ADMINISTRATOR"],
  },
];

export function hasPermission(permissions: number, flag: number): boolean {
  return (permissions & PERMISSIONS.ADMINISTRATOR) !== 0 || (permissions & flag) !== 0;
}
