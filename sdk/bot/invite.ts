import { Permissions, type PermissionName } from "./permissions";

/** Where Crystal lives. Pass `origin` to point at a preview deployment. */
export const CRYSTAL_ORIGIN = "https://usecrystal.app";

/** What to ask for when making an invite link. */
export interface InviteOptions {
  /** What to ask for, as names (`["SendMessages"]`), a `Permissions`, or the number. Default: nothing extra. */
  permissions?: PermissionName[] | Permissions | number;
  /** Access to ask for: `messages.read`, `members.read`, `dm.send`. */
  scopes?: ("messages.read" | "members.read" | "dm.send")[];
  /** Pre-select a community the person manages. */
  communityId?: string;
  /** Where to send the browser afterwards. Must be one of the bot's registered redirect addresses, or it is ignored. */
  redirectUri?: string;
  /** Sent back to the redirect address untouched, to tie the return to the request. */
  state?: string;
  /** Where Crystal is. Only needs setting for a preview deployment. */
  origin?: string;
}

/**
 * The link that adds a bot to a community: `https://usecrystal.app/oauth/authorize?client_id=…`.
 * Whoever opens it chooses a community they manage and what to allow; it only *asks*, and they can
 * give less than the link does but never more than they hold themselves. The bot also has to have
 * asked for at least as much in its project settings: the link can narrow that, not widen it.
 */
export function inviteUrl(botId: string, options: InviteOptions = {}): string {
  const bits = typeof options.permissions === "number" ? options.permissions : options.permissions instanceof Permissions ? options.permissions.bits : Permissions.resolve(...(options.permissions ?? []));
  const q = new URLSearchParams({ client_id: botId, scope: "bot" });
  if (bits) q.set("permissions", String(bits));
  if (options.scopes?.length) q.set("scopes", [...new Set(options.scopes)].join(","));
  if (options.communityId) q.set("community_id", options.communityId);
  if (options.redirectUri) q.set("redirect_uri", options.redirectUri);
  if (options.state) q.set("state", options.state.slice(0, 200));
  return `${(options.origin ?? CRYSTAL_ORIGIN).replace(/\/$/, "")}/oauth/authorize?${q.toString()}`;
}
