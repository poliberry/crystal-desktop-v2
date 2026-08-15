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
} as const;

export function hasPermission(permissions: number, flag: number): boolean {
  return (permissions & PERMISSIONS.ADMINISTRATOR) !== 0 || (permissions & flag) !== 0;
}
