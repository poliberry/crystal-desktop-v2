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
} as const;

export function hasPermission(permissions: number, flag: number): boolean {
  return (permissions & PERMISSIONS.ADMINISTRATOR) !== 0 || (permissions & flag) !== 0;
}
