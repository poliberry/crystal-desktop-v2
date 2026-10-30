/**
 * The community audit log's vocabulary: which actions exist, how they group, and how the one-line
 * detail of a permission change is worded. Pure data and functions — no database, no imports from
 * the Convex runtime — so the web app can render from the same list and it can be tested alone.
 * The writing side is `./communityAudit`.
 *
 * What goes in `details` is what changed, never message content: a name, a count, the permissions
 * added or taken away. The log is read by anyone with View Audit Log, which is a wider audience
 * than the people who could read the channel the action happened in.
 */
import { bitsHas } from "./permissionBits";
import { PERMISSIONS } from "./permissionFlags";

export const AUDIT_CATEGORIES = ["members", "roles", "channels", "server", "expressions", "invites", "voice", "messages"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  members: "Members",
  roles: "Roles",
  channels: "Channels",
  server: "Server settings",
  expressions: "Emoji and sounds",
  invites: "Invites",
  voice: "Voice moderation",
  messages: "Messages",
};

/** Every action the log records, with how it is shown. The key is what is stored. */
export const AUDIT_ACTIONS = {
  "member.kick": { label: "Kicked a member", category: "members" },
  "member.prune": { label: "Removed inactive members", category: "members" },
  "member.ban": { label: "Banned a member", category: "members" },
  "member.unban": { label: "Lifted a ban", category: "members" },
  "member.timeout": { label: "Timed a member out", category: "members" },
  "member.timeout_lift": { label: "Lifted a timeout", category: "members" },
  "member.nickname": { label: "Changed a member's nickname", category: "members" },
  "role.create": { label: "Created a role", category: "roles" },
  "role.update": { label: "Edited a role", category: "roles" },
  "role.delete": { label: "Deleted a role", category: "roles" },
  "role.reorder": { label: "Reordered roles", category: "roles" },
  "role.assign": { label: "Gave a role to a member", category: "roles" },
  "role.unassign": { label: "Took a role from a member", category: "roles" },
  "channel.create": { label: "Created a channel", category: "channels" },
  "channel.update": { label: "Edited a channel", category: "channels" },
  "channel.delete": { label: "Deleted a channel", category: "channels" },
  "channel.overwrite_set": { label: "Changed channel permissions", category: "channels" },
  "channel.overwrite_remove": { label: "Removed channel permissions", category: "channels" },
  "category.create": { label: "Created a category", category: "channels" },
  "category.rename": { label: "Renamed a category", category: "channels" },
  "category.delete": { label: "Deleted a category", category: "channels" },
  "community.update": { label: "Changed server settings", category: "server" },
  "community.icon": { label: "Changed the server icon", category: "server" },
  "community.banner": { label: "Changed the server banner", category: "server" },
  "emoji.create": { label: "Added an emoji", category: "expressions" },
  "emoji.delete": { label: "Deleted an emoji", category: "expressions" },
  "sound.create": { label: "Added a sound", category: "expressions" },
  "sound.update": { label: "Edited a sound", category: "expressions" },
  "sound.delete": { label: "Deleted a sound", category: "expressions" },
  "invite.create": { label: "Created an invite", category: "invites" },
  "invite.regenerate": { label: "Replaced the invite", category: "invites" },
  "voice.mute": { label: "Server-muted a member", category: "voice" },
  "voice.unmute": { label: "Lifted a server mute", category: "voice" },
  "voice.deafen": { label: "Server-deafened a member", category: "voice" },
  "voice.undeafen": { label: "Lifted a server deafen", category: "voice" },
  "voice.disconnect": { label: "Disconnected a member from voice", category: "voice" },
  "voice.stage": { label: "Changed who speaks on a stage", category: "voice" },
  "message.delete": { label: "Deleted a message", category: "messages" },
} as const satisfies Record<string, { label: string; category: AuditCategory }>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export const categoryOf = (action: AuditAction): AuditCategory => AUDIT_ACTIONS[action].category;

export const isAuditCategory = (value: string): value is AuditCategory => (AUDIT_CATEGORIES as readonly string[]).includes(value);

export const isAuditAction = (value: string): value is AuditAction => Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, value);

/** The actions that fall under one category, in the order they are declared. */
export const actionsIn = (category: AuditCategory): AuditAction[] => AUDIT_ACTION_KEYS.filter((a) => AUDIT_ACTIONS[a].category === category);

/** How long a row is kept. The log answers "who did this" for recent changes, not forever. */
export const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

const MAX_NAME = 80;
const MAX_DETAILS = 300;

/** A name or detail as it is stored: one line, no control characters, bounded. */
export function clip(text: string | undefined | null, max: number): string | undefined {
  if (!text) return undefined;
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const clipName = (text: string | undefined | null) => clip(text, MAX_NAME);
export const clipDetails = (text: string | undefined | null) => clip(text, MAX_DETAILS);

/** "Manage roles", from `MANAGE_ROLES`. The editor has friendlier wording; this only needs to be readable. */
function flagName(key: string): string {
  const words = key.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The permission names in `set`, by the one list the server enforces. */
export function permissionNames(set: number): string[] {
  return (Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]).filter((k) => bitsHas(set, PERMISSIONS[k])).map(flagName);
}

/**
 * What a change to a permission set did, as `+Name, +Name, -Name`, or undefined for no change.
 * Past `limit` names the rest are counted instead of listed, so a role that goes from nothing to
 * everything is a short line.
 */
export function describePermissionChange(before: number, after: number, limit = 6): string | undefined {
  const keys = Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[];
  const parts: string[] = [];
  for (const k of keys) {
    const was = bitsHas(before, PERMISSIONS[k]);
    const is = bitsHas(after, PERMISSIONS[k]);
    if (was !== is) parts.push(`${is ? "+" : "-"}${flagName(k)}`);
  }
  if (parts.length === 0) return undefined;
  if (parts.length <= limit) return parts.join(", ");
  return `${parts.slice(0, limit).join(", ")} and ${parts.length - limit} more`;
}

/** A timeout's length, for the detail line. */
export function describeDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/** Joins the parts of a detail line that exist. */
export function joinDetails(...parts: (string | undefined | false | null)[]): string | undefined {
  return clipDetails(parts.filter((p): p is string => !!p).join(" · "));
}

export interface AuditFilter {
  category?: string;
  action?: string;
  actorId?: string;
}

export interface AuditRowLike {
  action: string;
  category: string;
  actorId: string;
}

/** Whether a row passes the filter the viewer chose. The server filters with indexes; this is the same rule in one place. */
export function matchesAuditFilter(row: AuditRowLike, filter: AuditFilter): boolean {
  if (filter.category && row.category !== filter.category) return false;
  if (filter.action && row.action !== filter.action) return false;
  if (filter.actorId && row.actorId !== filter.actorId) return false;
  return true;
}

/** Which index a filter is best answered from: the actor if one is chosen, else the category, else time alone. */
export function auditIndexFor(filter: AuditFilter): "by_community_actor" | "by_community_category" | "by_community_time" {
  if (filter.actorId) return "by_community_actor";
  if (filter.category) return "by_community_category";
  return "by_community_time";
}

/** The label for a stored action, tolerating one this build does not know (a row written by a newer server). */
export function actionLabel(action: string): string {
  return isAuditAction(action) ? AUDIT_ACTIONS[action].label : action;
}
