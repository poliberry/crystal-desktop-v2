/** The shapes Crystal sends and returns. Mirrors the Bot API; you rarely need these directly. */

export interface APIUser {
  /** The user's id. */
  id: string;
  /** The handle after the at-sign, unique. */
  username: string;
  /** The display name. */
  name: string;
  /** Whether this is a bot account. */
  isBot: boolean;
}

/** A file attached to a message. */
export interface APIAttachment {
  /** The file's name. */
  fileName: string;
  /** Its media type, such as `image/png`. */
  fileType: string;
  /** Its size in bytes. */
  fileSize: number;
  /** Where to download it, or `null` if it isn't available. */
  url: string | null;
}

/** A rich card under a message's text. Build one with `EmbedBuilder`. */
export interface APIEmbed {
  /** The heading. */
  title?: string;
  /** The body text. */
  description?: string;
  /** Makes the title a link. https only. */
  url?: string;
  /** 0xRRGGBB */
  color?: number;
  /** A time shown in the footer, as milliseconds or an ISO string. */
  timestamp?: number | string;
  /** A small line above the title. */
  author?: { name: string; url?: string; iconUrl?: string };
  /** A small line under the card. */
  footer?: { text: string; iconUrl?: string };
  /** A large picture under the text. https only. */
  image?: { url: string };
  /** A small picture in the corner. https only. */
  thumbnail?: { url: string };
  /** Name and value pairs; `inline` ones sit side by side. */
  fields?: { name: string; value: string; inline?: boolean }[];
}

/** How a button looks. `link` opens a web address and needs `url` rather than `customId`. */
export type ButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";
/** One button on a message. */
export interface APIButton {
  /** What you get back in `interactionCreate` when it is pressed. Not for link buttons. */
  customId?: string;
  /** The text on the button. */
  label?: string;
  /** How it looks. */
  style?: ButtonStyle;
  /** For a link button: where it opens. https only. */
  url?: string;
  /** An emoji shown beside the label. */
  emoji?: string;
  /** Shown but can't be pressed. */
  disabled?: boolean;
}
/** A row of buttons under a message. */
export interface APIActionRow {
  /** Up to five buttons. */
  buttons: APIButton[];
}

/** A message as Crystal sends it. */
export interface APIMessage {
  /** The message's id. */
  id: string;
  /** What it says. */
  text: string;
  /** When it was sent, in milliseconds. */
  createdAt: number;
  /** When it was last edited, if it was. */
  editedAt?: number | null;
  /** The message this replies to, if any. */
  replyToId: string | null;
  /** Whether it is pinned. */
  pinned?: boolean;
  /** Who sent it; `null` if that account is gone. */
  author: APIUser | null;
  /** Files on it. */
  attachments: APIAttachment[];
  /** Rich cards on it. */
  embeds?: APIEmbed[];
  /** Rows of buttons on it. */
  components?: APIActionRow[];
}

/** A channel in a community. */
export interface APIChannel {
  /** The channel's id. */
  id: string;
  /** The community it is in. */
  communityId?: string;
  /** Its name. */
  name: string;
  /** `text` or `voice`. */
  type: "text" | "voice" | string;
  /** Its topic line. */
  topic?: string | null;
  /** The category it is under. */
  categoryId?: string | null;
  /** Where it sits in the list. */
  position?: number;
  /** Whether the bot may send messages here right now. */
  canSend?: boolean;
}

/** Someone in a community. */
export interface APIMember extends APIUser {
  /** When they joined, in milliseconds. */
  joinedAt: number;
}

/** A community member with their roles and moderation state. */
export interface APIMemberDetail extends APIMember {
  /** Their nickname in this community. */
  nickname: string | null;
  /** When a timeout ends, in milliseconds; `null` if not timed out. */
  timeoutUntil: number | null;
  /** The ids of their roles. */
  roleIds: string[];
  /** Whether they own the community. */
  isOwner: boolean;
}

/** A role in a community. */
export interface APIRole {
  /** The role's id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its colour as `#rrggbb`, or `null`. */
  color: string | null;
  /** Its permission bits (see `PermissionFlags`). */
  permissions: number;
  /** Higher is more senior. */
  position: number;
  /** Whether it is listed separately in the member list. */
  hoist: boolean;
  /** Whether this is the role everyone has. */
  isEveryone: boolean;
  /** Whether it belongs to an integration and can't be edited by hand. */
  managed: boolean;
}

/** A custom emoji a community has. */
export interface APIEmoji {
  /** The emoji's id. */
  id: string;
  /** Its name. */
  name: string;
  /** Where its picture is. */
  imageUrl: string;
  /** What to write in a message to use it: `<:name:id>`. */
  mention: string;
}

/** A soundboard clip a community has. */
export interface APISound {
  /** The clip's id. */
  id: string;
  /** Its name. */
  name: string;
  /** The emoji shown on its button. */
  emoji: string | null;
  /** Where the audio is. */
  soundUrl: string;
  /** How long it plays, in milliseconds. */
  durationMs: number | null;
}

/** A ban in a community. */
export interface APIBan {
  /** Who was banned. */
  user: APIUser | null;
  /** Why, if one was given. */
  reason: string | null;
  /** When, in milliseconds. */
  bannedAt: number;
}

/** The bot itself, and where it is installed. */
export interface APIMe {
  /** The bot's id for the API. */
  id: string;
  /** Its account id: the author of its messages. */
  userId: string;
  /** Its handle. */
  username: string;
  /** Its display name. */
  name: string;
  /** Its bio. */
  bio: string | null;
  /** Its avatar. */
  imageUrl: string | null;
  /** Every community it is in, with what it was `granted`, what it can do `effective`ly right now, its access `scopes`, and whether it is `active` (and `reason` if not). */
  communities: { id: string; name: string; granted: number; effective: number; scopes: string[]; active: boolean; reason: string | null }[];
}

/** Someone in a voice channel. */
export interface APIVoiceParticipant {
  /** Who. */
  user: APIUser | null;
  /** When they joined, in milliseconds. */
  joinedAt: number;
  /** They muted themselves. */
  muted: boolean;
  /** They deafened themselves. */
  deafened: boolean;
  /** They are sharing their screen. */
  streaming: boolean;
  /** A moderator muted them. */
  serverMuted: boolean;
  /** A moderator deafened them. */
  serverDeafened: boolean;
}

// --- Events -----------------------------------------------------------------------------------

/** What every event has. */
interface BaseEvent {
  /** A unique id; the same event is never handled twice. */
  id: string;
  /** When it happened, in milliseconds. */
  createdAt: number;
}
/** Sent to check that your endpoint works. */
export interface PingEvent extends BaseEvent {
  /** `"ping"`. */
  type: "ping";
}
/** The bot was added to a community. */
export interface BotInstalledEvent extends BaseEvent {
  /** `"bot.installed"`. */
  type: "bot.installed";
  /** The community. */
  communityId: string;
  /** Its name. */
  communityName: string;
  /** Who added the bot. */
  authorisedBy: { id: string; username: string };
}
/** A message was sent. */
export interface MessageCreatedEvent extends BaseEvent {
  /** `"message.created"`. */
  type: "message.created";
  /** The community. */
  communityId: string;
  /** The channel. */
  channelId: string;
  /** The message, with its author. */
  message: APIMessage & { author: APIUser };
}
/** A message was edited. */
export interface MessageUpdatedEvent extends BaseEvent {
  /** `"message.updated"`. */
  type: "message.updated";
  /** The community. */
  communityId: string;
  /** The channel. */
  channelId: string;
  /** The message as it is now. */
  message: APIMessage;
}
/** A message was deleted. */
export interface MessageDeletedEvent extends BaseEvent {
  /** `"message.deleted"`. */
  type: "message.deleted";
  /** The community. */
  communityId: string;
  /** The channel. */
  channelId: string;
  /** The message that was deleted. */
  messageId: string;
}
/** A reaction was added to or removed from a message. */
export interface ReactionEvent extends BaseEvent {
  /** `"reaction.added"` or `"reaction.removed"`. */
  type: "reaction.added" | "reaction.removed";
  /** The community. */
  communityId: string;
  /** The channel. */
  channelId: string;
  /** The message reacted to. */
  messageId: string;
  /** The emoji. */
  emoji: string;
  /** Who reacted. */
  user: APIUser;
}
/** Someone joined or left a community. Needs the `members.read` access. */
export interface MemberEvent extends BaseEvent {
  /** `"member.joined"` or `"member.left"`. */
  type: "member.joined" | "member.left";
  /** The community. */
  communityId: string;
  /** Who. */
  member: APIUser;
}
/** A channel was created, changed or deleted. */
export interface ChannelEvent extends BaseEvent {
  /** `"channel.created"`, `"channel.updated"` or `"channel.deleted"`. */
  type: "channel.created" | "channel.updated" | "channel.deleted";
  /** The community. */
  communityId: string;
  /** The channel as it is now (or was, if deleted). */
  channel: { id: string; name: string; type: string; topic: string | null };
}
/** Someone joined or left a voice channel. */
export interface VoiceStateEvent extends BaseEvent {
  /** `"voice.state"`. */
  type: "voice.state";
  /** The community. */
  communityId: string;
  /** The voice channel. */
  channelId: string;
  /** `joined` or `left`. */
  action: "joined" | "left";
  /** Who. */
  user: APIUser;
}
/** Someone used one of the bot's slash commands. */
export interface CommandEvent extends BaseEvent {
  /** `"interaction.command"`. */
  type: "interaction.command";
  /** The community. */
  communityId: string;
  /** Where it was used. */
  channelId: string;
  /** The command's name, without the `/`. */
  command: string;
  /** Everything typed after it. */
  args: string;
  /** Who used it. */
  user: { id: string; username: string; name: string };
}
/** Someone pressed a button on one of the bot's messages. */
export interface ButtonEvent extends BaseEvent {
  /** `"interaction.button"`. */
  type: "interaction.button";
  /** The community. */
  communityId: string;
  /** The channel. */
  channelId: string;
  /** The message the button is on. */
  messageId: string;
  /** The button's `customId`. */
  customId: string;
  /** Who pressed it. */
  user: { id: string; username: string; name: string };
}
/** Every event Crystal can send, told apart by `type`. */
export type CrystalEvent =
  | PingEvent
  | BotInstalledEvent
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | ReactionEvent
  | MemberEvent
  | ChannelEvent
  | VoiceStateEvent
  | CommandEvent
  | ButtonEvent;
