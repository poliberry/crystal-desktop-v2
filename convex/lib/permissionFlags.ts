/**
 * Community permission flags: the one list the server enforces and the client renders from.
 * Pure data — no imports — so the web app can import it too (`src/lib/permissions.ts`).
 *
 * Read `./permissionBits` before adding one: flags above bit 30 can't be tested with `&`.
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
  /** Ping a role, `@everyone` or `@here`. Without it those still render as
   * mentions but notify nobody — see convex/lib/mentions.ts. */
  MENTION_EVERYONE: 1 << 17,
  /** Connect a Pterodactyl panel and decide who may do what to its servers. */
  MANAGE_GAME_SERVERS: 1 << 18,
  /** Create, edit and cancel events and scrims. */
  MANAGE_EVENTS: 1 << 19,
  /** Add bots and integrations to the community, decide what they may do, and remove them.
   * A person can only give a bot permissions they hold themselves — see convex/lib/botAuth.ts. */
  MANAGE_INTEGRATIONS: 1 << 20,

  // --- Added for parity with Discord's permission set -------------------------------------
  //
  // Bits 21–30 are ordinary `1 << n` flags. Bit 31 is skipped (it is the sign bit), so the
  // rest are `2 ** n` and can only be tested through `lib/permissionBits.ts` — see there.

  /** Change their own nickname in this community. */
  CHANGE_NICKNAME: 1 << 21,
  /** Add custom emoji and soundboard clips (managing other people's still takes MANAGE_EMOJIS). */
  CREATE_EXPRESSIONS: 1 << 22,
  /** Create events and scrims (editing and cancelling anyone's still takes MANAGE_EVENTS). */
  CREATE_EVENTS: 1 << 23,
  /** Links in their messages unfurl into previews. */
  EMBED_LINKS: 1 << 24,
  /** Upload files and images. */
  ATTACH_FILES: 1 << 25,
  /** Add new reactions to a message. */
  ADD_REACTIONS: 1 << 26,
  /** Use custom emoji from other communities. */
  USE_EXTERNAL_EMOJIS: 1 << 27,
  /** Scroll back through messages sent before they opened the channel. */
  READ_MESSAGE_HISTORY: 1 << 28,
  /** Pin and unpin messages (MANAGE_MESSAGES still does too). */
  PIN_MESSAGES: 1 << 29,
  /** Use slash commands and buttons of bots. */
  USE_APPLICATION_COMMANDS: 1 << 30,

  /** Talk in voice channels. */
  SPEAK: 2 ** 32,
  /** Turn their camera on and share their screen. */
  VIDEO: 2 ** 33,
  /** Play soundboard clips in voice. */
  USE_SOUNDBOARD: 2 ** 34,
  /** Play soundboard clips from other communities. */
  USE_EXTERNAL_SOUNDS: 2 ** 35,
  /** Speak by voice activity rather than push-to-talk. */
  USE_VAD: 2 ** 36,
  /** Be heard over others who are talking. */
  PRIORITY_SPEAKER: 2 ** 37,
  /** Set the status line of a voice channel. */
  SET_VOICE_STATUS: 2 ** 38,
  /** Ask to speak in a stage-style channel. */
  REQUEST_TO_SPEAK: 2 ** 39,
  /** Start an activity in a voice channel. */
  USE_EMBEDDED_ACTIVITIES: 2 ** 40,
  /** Start a thread / forum post (public). */
  CREATE_PUBLIC_THREADS: 2 ** 41,
  /** Start a private thread. */
  CREATE_PRIVATE_THREADS: 2 ** 42,
  /** Reply inside threads and forum posts. */
  SEND_MESSAGES_IN_THREADS: 2 ** 43,
  /** Lock, archive and remove threads and forum posts (MANAGE_MESSAGES still does too). */
  MANAGE_THREADS: 2 ** 44,
  /** Use custom stickers from other communities. */
  USE_EXTERNAL_STICKERS: 2 ** 45,
  /** Send text-to-speech messages. */
  SEND_TTS: 2 ** 46,
  /** Send voice messages. */
  SEND_VOICE_MESSAGES: 2 ** 47,
  /** Create polls. */
  CREATE_POLLS: 2 ** 48,
  /** Ignore a channel's slowmode. */
  BYPASS_SLOWMODE: 2 ** 49,
  /** See the community's audit log. */
  VIEW_AUDIT_LOG: 2 ** 50,
  /** See the community's insights. */
  VIEW_INSIGHTS: 2 ** 51,
  /** See a creator community's earnings and subscriber numbers. */
  VIEW_CREATOR_MONETIZATION: 2 ** 52,
} as const;

export type PermissionFlag = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
