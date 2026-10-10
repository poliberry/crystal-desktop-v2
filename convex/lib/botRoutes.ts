/**
 * Every route of the Bot API, as data: a method, a path with `:params`, and the operation it runs.
 *
 * One table, read by the HTTP layer to route requests, by `botOps.ts` to know which operations
 * exist, and by the tests and the docs — so a route can't be added in one place and forgotten in
 * another. `match` is pure; nothing here touches the database.
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Route {
  method: Method;
  /** `/channels/:channelId/messages/:messageId` */
  path: string;
  op: string;
  /** What a request to it may carry that isn't JSON: `files` (message attachments), `image` or `audio`. */
  upload?: "files" | "image" | "audio";
  summary: string;
}

const r = (method: Method, path: string, op: string, summary: string, upload?: Route["upload"]): Route => ({ method, path, op, summary, upload });

export const ROUTES: Route[] = [
  r("GET", "/me", "me", "Who this bot is and where it has been added."),
  r("PATCH", "/me", "profile.update", "Change the bot's bio or avatar."),
  r("GET", "/events", "events.poll", "Collect events, for a bot with no endpoint: ?after=<cursor>&wait=<seconds, up to 25> waits for something to happen. The SDK does this for you."),
  r("PUT", "/commands", "commands.set", "Replace the bot's slash commands."),
  r("POST", "/uploads", "upload.ticket", "Get a one-use address to upload a file to; the answer's storageId goes into the calls that take files."),
  r("PUT", "/presence", "presence.set", "Set the bot's status, custom status and activities. Call it every 30 seconds to stay online."),
  r("GET", "/users/:userId/presence", "presence.get", "Someone's status and activities (members.read)."),

  r("GET", "/communities/:communityId", "community.get", "A community."),
  r("GET", "/communities/:communityId/channels", "channel.list", "The channels the bot can see."),
  r("POST", "/communities/:communityId/channels", "channel.create", "Create a text or voice channel (Manage channels)."),
  r("GET", "/communities/:communityId/members", "member.list", "The member list (members.read)."),
  r("GET", "/communities/:communityId/members/:userId", "member.get", "One member and their roles (members.read)."),
  r("PATCH", "/communities/:communityId/members/:userId", "member.update", "Change a member's nickname."),
  r("DELETE", "/communities/:communityId/members/:userId", "member.kick", "Remove a member (Remove members)."),
  r("PUT", "/communities/:communityId/members/:userId/timeout", "member.timeout", "Time a member out (Time members out)."),
  r("PUT", "/communities/:communityId/members/:userId/roles/:roleId", "member.role.add", "Give a member a role (Manage roles)."),
  r("DELETE", "/communities/:communityId/members/:userId/roles/:roleId", "member.role.remove", "Take a role from a member (Manage roles)."),
  r("GET", "/communities/:communityId/bans", "ban.list", "The banned (Ban members)."),
  r("PUT", "/communities/:communityId/bans/:userId", "ban.add", "Ban a member (Ban members)."),
  r("DELETE", "/communities/:communityId/bans/:userId", "ban.remove", "Lift a ban (Ban members)."),
  r("POST", "/communities/:communityId/invites", "invite.get", "The community's invite code (Create invites)."),
  r("GET", "/communities/:communityId/roles", "role.list", "The roles (members.read)."),
  r("POST", "/communities/:communityId/roles", "role.create", "Create a role (Manage roles)."),
  r("GET", "/communities/:communityId/emojis", "emoji.list", "The custom emojis."),
  r("POST", "/communities/:communityId/emojis", "emoji.create", "Add a custom emoji (Manage emojis and sounds).", "image"),
  r("DELETE", "/communities/:communityId/emojis/:emojiId", "emoji.delete", "Remove a custom emoji (Manage emojis and sounds)."),
  r("GET", "/communities/:communityId/sounds", "sound.list", "The soundboard clips."),
  r("POST", "/communities/:communityId/sounds", "sound.create", "Add a soundboard clip (Manage emojis and sounds).", "audio"),
  r("DELETE", "/communities/:communityId/sounds/:soundId", "sound.delete", "Remove a soundboard clip (Manage emojis and sounds)."),

  r("PATCH", "/roles/:roleId", "role.update", "Edit a role below the bot's own (Manage roles)."),
  r("DELETE", "/roles/:roleId", "role.delete", "Delete a role below the bot's own (Manage roles)."),

  r("GET", "/channels/:channelId", "channel.get", "A channel."),
  r("PATCH", "/channels/:channelId", "channel.update", "Rename a channel or change its topic (Manage channels)."),
  r("DELETE", "/channels/:channelId", "channel.delete", "Delete a channel (Manage channels)."),
  r("GET", "/channels/:channelId/overwrites", "overwrite.list", "Who a channel's permissions are changed for (Manage channels)."),
  r("PUT", "/channels/:channelId/overwrites/:kind/:targetId", "overwrite.set", "Change a channel's permissions for a role or member (Manage channels)."),
  r("DELETE", "/channels/:channelId/overwrites/:kind/:targetId", "overwrite.delete", "Remove such a change (Manage channels)."),
  r("POST", "/channels/:channelId/typing", "typing", "Show the bot as typing."),

  r("GET", "/channels/:channelId/messages", "message.list", "Recent messages, newest first (messages.read)."),
  r("POST", "/channels/:channelId/messages", "message.send", "Send a message, with embeds, buttons and files.", "files"),
  r("POST", "/channels/:channelId/messages/bulk-delete", "message.bulkDelete", "Delete up to 100 messages (Manage messages)."),
  r("GET", "/channels/:channelId/messages/:messageId", "message.get", "One message (messages.read)."),
  r("PATCH", "/channels/:channelId/messages/:messageId", "message.edit", "Edit one of the bot's own messages."),
  r("DELETE", "/channels/:channelId/messages/:messageId", "message.delete", "Delete a message."),
  r("PUT", "/channels/:channelId/messages/:messageId/reactions/:emoji", "reaction.add", "React to a message."),
  r("DELETE", "/channels/:channelId/messages/:messageId/reactions/:emoji", "reaction.remove", "Remove the bot's reaction."),
  r("DELETE", "/channels/:channelId/messages/:messageId/reactions", "reaction.clear", "Remove everyone's reactions (Manage messages)."),
  r("GET", "/channels/:channelId/pins", "pin.list", "Pinned messages (messages.read)."),
  r("PUT", "/channels/:channelId/pins/:messageId", "pin.add", "Pin a message (Manage messages)."),
  r("DELETE", "/channels/:channelId/pins/:messageId", "pin.remove", "Unpin a message (Manage messages)."),

  r("GET", "/channels/:channelId/voice", "voice.list", "Who is in a voice channel."),
  r("POST", "/channels/:channelId/voice/join", "voice.join", "Join a voice channel: returns a LiveKit token to connect with. Audio and soundboard only (Join voice channels)."),
  r("POST", "/channels/:channelId/voice/leave", "voice.leave", "Leave a voice channel."),
  r("PUT", "/channels/:channelId/voice/state", "voice.state", "Say whether the bot is muted or deafened."),
  r("PATCH", "/channels/:channelId/voice/members/:userId", "voice.member.update", "Server-mute or deafen a member (Mute / Deafen members)."),
  r("DELETE", "/channels/:channelId/voice/members/:userId", "voice.member.disconnect", "Disconnect a member from voice (Disconnect members)."),

  r("POST", "/users/:userId/messages", "dm.send", "Send a direct message to someone who just used one of the bot's commands or buttons (dm.send)."),
];

export interface Matched {
  route: Route;
  params: Record<string, string>;
}

/**
 * Find the route for a request. Segments are compared whole (no regex built from the table), a
 * literal segment beats a `:param` one (so `/messages/bulk-delete` is the bulk route, not a
 * message called "bulk-delete"), and a path that matches by shape but not method is reported so
 * the caller can answer 405 rather than 404.
 */
export function matchRoute(method: string, path: string): { matched: Matched } | { methodNotAllowed: Method[] } | null {
  const parts = path.split("/").filter(Boolean);
  const allowed = new Set<Method>();
  let best: { matched: Matched; literals: number } | null = null;
  for (const route of ROUTES) {
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let literals = 0;
    let fits = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(":")) {
        let value: string;
        try {
          value = decodeURIComponent(parts[i]);
        } catch {
          fits = false;
          break;
        }
        if (!value || value.length > 200) {
          fits = false;
          break;
        }
        params[pattern[i].slice(1)] = value;
      } else if (pattern[i] === parts[i]) literals++;
      else {
        fits = false;
        break;
      }
    }
    if (!fits) continue;
    if (route.method !== method) {
      allowed.add(route.method);
      continue;
    }
    if (!best || literals > best.literals) best = { matched: { route, params }, literals };
  }
  if (best) return { matched: best.matched };
  return allowed.size ? { methodNotAllowed: [...allowed] } : null;
}
