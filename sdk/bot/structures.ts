import { toJSON } from "./builders";
import type { ActionRowBuilder, EmbedBuilder } from "./builders";
import type { Client } from "./client";
import { CrystalError } from "./errors";
import { readFileInput, type FileInput } from "./files";
import { Permissions } from "./permissions";
import type { APIActionRow, APIAttachment, APIBan, APIChannel, APIEmbed, APIEmoji, APIMember, APIMemberDetail, APIMessage, APIRole, APISound, APIUser, APIVoiceParticipant } from "./types";
import { VoiceConnection } from "./voice";

/** A Map with the few helpers worth having, as discord.js's Collection. */
export class Collection<V> extends Map<string, V> {
  /** The first value the function returns true for, or `undefined`. */
  find(fn: (v: V) => boolean): V | undefined {
    for (const v of this.values()) if (fn(v)) return v;
    return undefined;
  }
  /** A new collection of just the values the function returns true for. */
  filter(fn: (v: V) => boolean): Collection<V> {
    const out = new Collection<V>();
    for (const [k, v] of this) if (fn(v)) out.set(k, v);
    return out;
  }
  /** The function's result for each value, as an array. */
  map<R>(fn: (v: V) => R): R[] {
    return [...this.values()].map(fn);
  }
  /** The first value, or `undefined` if there are none. */
  first(): V | undefined {
    return this.values().next().value;
  }
  /** The values, as an array. */
  toArray(): V[] {
    return [...this.values()];
  }
}

/** `<@id>`: written into a message, it mentions that person. */
export const userMention = (id: string) => `<@${id}>`;
/** `<@&id>`: written into a message, mentions that role. */
export const roleMention = (id: string) => `<@&${id}>`;
/** Pings everyone in the channel. Needs the "Mention everyone" permission. */
export const everyone = "@everyone";

/** An `EmbedBuilder`, or the same thing as plain data. */
export type EmbedLike = EmbedBuilder | APIEmbed;
/** An `ActionRowBuilder`, or the same thing as plain data. */
export type RowLike = ActionRowBuilder | APIActionRow;

/** What you can send. A bare string is just text. */
export type MessageOptions =
  | string
  | {
      content?: string;
      embeds?: EmbedLike[];
      /** Rows of buttons. */
      components?: RowLike[];
      /** Paths on disk, or `{ name, data }`. Up to 4. */
      files?: FileInput[];
      /** A message (or its id) to reply to. */
      replyTo?: string | Message;
      /** Whether replying notifies the author. Default true. */
      pingReply?: boolean;
    };

/** A person or bot account: who wrote a message, ran a command or pressed a button. */
export class User {
  /** Their account id. It never changes, so use it (not `username`) to recognise someone. */
  readonly id: string;
  /** Their handle, without the leading at-sign. */
  readonly username: string;
  /** Their display name. */
  readonly name: string;
  /** Whether this is a bot account. */
  readonly isBot: boolean;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @internal
   */
  constructor(readonly client: Client, data: { id: string; username: string; name: string; isBot?: boolean }) {
    this.id = data.id;
    this.username = data.username;
    this.name = data.name;
    this.isBot = !!data.isBot;
  }
  /** Written into a message, mentions this person. */
  toString() {
    return userMention(this.id);
  }
  /**
   * Message this person privately. Allowed only for someone who used one of your bot's commands or
   * buttons in the last 15 minutes, in a community that gave it the "Send direct messages" access —
   * so a bot can answer someone, but can't start talking to people who haven't spoken to it.
   * Up to three per person per window.
   */
  async send(content: string): Promise<{ id: string }> {
    return this.client.rest.post<{ id: string }>(`/users/${this.id}/messages`, { content });
  }
  /** Their status and activities. Needs the "See the member list" access. */
  async fetchPresence() {
    return this.client.rest.get<{ status: string; activities: { type: string; name: string; details: string | null; state: string | null }[]; customStatus: string | null }>(`/users/${this.id}/presence`);
  }
}

/** A text or voice channel in a community. Get one from `message.channel`, `interaction.channel`, `community.channels.fetch()` or `client.channels`. */
export class Channel {
  /** The channel's name, without the #. */
  name: string;
  /** `"text"` or `"voice"`. */
  type: string;
  /** The line shown under its name, or `null`. */
  topic: string | null = null;
  /** The category it sits in, or `null`. */
  categoryId: string | null = null;
  /** Whether the bot may post here, when that is known. */
  canSend?: boolean;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param id The channel's id.
   * @param communityId The community it belongs to, or `null` if that isn't known yet.
   * @internal
   */
  constructor(readonly client: Client, readonly id: string, readonly communityId: string | null, data?: Partial<APIChannel>) {
    this.name = data?.name ?? "";
    this.type = data?.type ?? "text";
    if (data) this.update(data);
  }
  /**
   * Apply fresh data from an event.
   * @internal
   */
  update(data: Partial<APIChannel>) {
    if (data.name !== undefined) this.name = data.name;
    if (data.type !== undefined) this.type = data.type;
    if (data.topic !== undefined) this.topic = data.topic;
    if (data.categoryId !== undefined) this.categoryId = data.categoryId;
    if (data.canSend !== undefined) this.canSend = data.canSend;
  }
  /** Whether this is a voice channel. */
  get isVoice() {
    return this.type === "voice";
  }
  /** Whether this is a text channel. */
  get isText() {
    return this.type === "text";
  }
  /** The community it belongs to, once the bot has loaded it. */
  get community(): Community | undefined {
    return this.communityId ? this.client.communities.get(this.communityId) : undefined;
  }
  /** `#name`, so a channel written into a template string reads as one. */
  toString() {
    return `#${this.name}`;
  }

  /** Post a message: text, embeds, buttons and files. Needs "Send messages". */
  async send(options: MessageOptions): Promise<Message> {
    const o = typeof options === "string" ? { content: options } : options;
    const body: Record<string, unknown> = {};
    if (o.content !== undefined) body.content = o.content;
    if (o.embeds?.length) body.embeds = o.embeds.map((e) => toJSON<APIEmbed>(e));
    if (o.components?.length) body.components = o.components.map((r) => toJSON<APIActionRow>(r));
    if (o.replyTo) body.replyToId = typeof o.replyTo === "string" ? o.replyTo : o.replyTo.id;
    if (o.pingReply === false) body.pingReply = false;
    if (o.files?.length) {
      body.files = [];
      for (const f of o.files) {
        const file = await readFileInput(f);
        (body.files as unknown[]).push({ storageId: await this.client.rest.upload(file.bytes, file.contentType), fileName: file.name });
      }
    }
    const { id } = await this.client.rest.post<{ id: string }>(`/channels/${this.id}/messages`, body);
    const me = this.client.user;
    return new Message(this.client, this, {
      id,
      text: o.content ?? "",
      createdAt: Date.now(),
      replyToId: body.replyToId ? String(body.replyToId) : null,
      author: { id: me?.id ?? "", username: me?.username ?? "", name: me?.name ?? "", isBot: true },
      attachments: [],
      embeds: body.embeds as APIEmbed[] | undefined,
      components: body.components as APIActionRow[] | undefined,
    });
  }
  /** The latest messages, newest first. Needs the "Read messages" access. */
  async fetchMessages(options: { limit?: number; before?: string | Message } = {}): Promise<Collection<Message>> {
    const q = new URLSearchParams();
    if (options.limit) q.set("limit", String(options.limit));
    if (options.before) q.set("before", typeof options.before === "string" ? options.before : options.before.id);
    const res = await this.client.rest.get<{ messages: APIMessage[] }>(`/channels/${this.id}/messages${q.size ? `?${q}` : ""}`);
    const out = new Collection<Message>();
    for (const m of res.messages) out.set(m.id, new Message(this.client, this, m));
    return out;
  }
  /** One message by its id. Needs the "Read messages" access. */
  async fetchMessage(id: string): Promise<Message> {
    return new Message(this.client, this, await this.client.rest.get<APIMessage>(`/channels/${this.id}/messages/${id}`));
  }
  /** Pinned messages. Needs the "Read messages" access. */
  async fetchPins(): Promise<Collection<Message>> {
    const res = await this.client.rest.get<{ messages: APIMessage[] }>(`/channels/${this.id}/pins`);
    const out = new Collection<Message>();
    for (const m of res.messages) out.set(m.id, new Message(this.client, this, m));
    return out;
  }
  /** Delete up to 100 messages at once. Needs "Manage messages". All or none: one wrong id stops the lot. */
  async bulkDelete(messages: (string | Message)[]): Promise<number> {
    const res = await this.client.rest.post<{ deleted: number }>(`/channels/${this.id}/messages/bulk-delete`, { messageIds: messages.map((m) => (typeof m === "string" ? m : m.id)) });
    return res.deleted;
  }
  /** Show the bot as typing for a few seconds. */
  async sendTyping(): Promise<void> {
    await this.client.rest.post(`/channels/${this.id}/typing`);
  }
  /** Needs "Manage channels". */
  async edit(changes: { name?: string; topic?: string | null }): Promise<this> {
    await this.client.rest.patch(`/channels/${this.id}`, changes);
    this.update(changes);
    return this;
  }
  /** Rename the channel. Needs "Manage channels". */
  setName(name: string) {
    return this.edit({ name });
  }
  /** Change the topic (`null` clears it). Needs "Manage channels". */
  setTopic(topic: string | null) {
    return this.edit({ topic });
  }
  /** Needs "Manage channels". */
  async delete(): Promise<void> {
    await this.client.rest.delete(`/channels/${this.id}`);
    this.client.channels.delete(this.id);
  }

  /** Who a channel's permissions are changed for. Needs "Manage channels". */
  async fetchOverwrites() {
    return (await this.client.rest.get<{ overwrites: { kind: "role" | "member"; targetId: string; allow: number; deny: number }[] }>(`/channels/${this.id}/overwrites`)).overwrites;
  }
  /**
   * Allow or deny permissions for a role or a member in this channel. A bot can only *allow*
   * what it holds itself (and never Administrator); denying is always allowed.
   */
  async setOverwrite(target: Role | Member | { kind: "role" | "member"; id: string }, change: { allow?: number; deny?: number }): Promise<void> {
    const t = target instanceof Role ? { kind: "role", id: target.id } : target instanceof Member ? { kind: "member", id: target.id } : target;
    await this.client.rest.put(`/channels/${this.id}/overwrites/${t.kind}/${t.id}`, { allow: change.allow ?? 0, deny: change.deny ?? 0 });
  }
  /** Remove a role's or member's permission overwrite from this channel. Needs "Manage channels". */
  async deleteOverwrite(target: Role | Member | { kind: "role" | "member"; id: string }): Promise<void> {
    const t = target instanceof Role ? { kind: "role", id: target.id } : target instanceof Member ? { kind: "member", id: target.id } : target;
    await this.client.rest.delete(`/channels/${this.id}/overwrites/${t.kind}/${t.id}`);
  }

  // --- voice ---
  /** Who is in this voice channel. */
  async fetchVoiceParticipants(): Promise<{ user: User | null; joinedAt: Date; muted: boolean; deafened: boolean; serverMuted: boolean; serverDeafened: boolean }[]> {
    if (!this.isVoice) throw new CrystalError("That isn't a voice channel.");
    const res = await this.client.rest.get<{ participants: APIVoiceParticipant[] }>(`/channels/${this.id}/voice`);
    return res.participants.map((p) => ({ user: p.user ? new User(this.client, p.user) : null, joinedAt: new Date(p.joinedAt), muted: p.muted, deafened: p.deafened, serverMuted: p.serverMuted, serverDeafened: p.serverDeafened }));
  }
  /**
   * Join this voice channel and get a connection to play audio and soundboard clips through.
   * Needs "Join voice channels", and LiveKit's optional Node package installed (the voice guide
   * says how). Bots can speak and play soundboard clips; they can't share video or a screen.
   */
  async join(): Promise<VoiceConnection> {
    if (!this.isVoice) throw new CrystalError("That isn't a voice channel.");
    return VoiceConnection.connect(this.client, this);
  }
}

/** Someone adding or removing an emoji on a message. Comes with `Events.ReactionAdd` and `Events.ReactionRemove`. */
export class Reaction {
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param channelId The channel the message is in.
   * @param messageId The message that was reacted to.
   * @param emoji The emoji: a character like 👍, or a custom emoji's `<:name:id>`.
   * @param user Who reacted.
   * @internal
   */
  constructor(readonly client: Client, readonly channelId: string, readonly messageId: string, readonly emoji: string, readonly user: User) {}
  /** The channel it happened in. */
  get channel(): Channel {
    return this.client.channelFor(this.channelId, null);
  }
}

/** A message in a channel. Arrives with `Events.MessageCreate`, and comes back from `channel.send()`, `message.reply()` and `channel.fetchMessages()`. */
export class Message {
  /** The message's id. */
  readonly id: string;
  /** The text. Empty if it is only embeds or files. */
  readonly content: string;
  /** When it was sent. */
  readonly createdAt: Date;
  /** When it was last edited, or `null`. */
  readonly editedAt: Date | null;
  /** The id of the message it replies to, or `null`. */
  readonly replyToId: string | null;
  /** Who wrote it. */
  readonly author: User;
  /** Files attached to it. */
  readonly attachments: APIAttachment[];
  /** Its rich embeds. */
  readonly embeds: APIEmbed[];
  /** Its rows of buttons. */
  readonly components: APIActionRow[];
  /** Whether it is pinned. */
  readonly pinned: boolean;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param channel The channel it is in.
   * @internal
   */
  constructor(readonly client: Client, readonly channel: Channel, data: APIMessage) {
    this.id = data.id;
    this.content = data.text;
    this.createdAt = new Date(data.createdAt);
    this.editedAt = data.editedAt ? new Date(data.editedAt) : null;
    this.replyToId = data.replyToId;
    this.author = new User(client, data.author ?? { id: "", username: "unknown", name: "Unknown" });
    this.attachments = data.attachments ?? [];
    this.embeds = data.embeds ?? [];
    this.components = data.components ?? [];
    this.pinned = !!data.pinned;
  }
  /** The community it is in, if known. */
  get communityId() {
    return this.channel.communityId;
  }
  /** Whether a bot (this one, or another) wrote it. */
  get fromBot() {
    return this.author.isBot;
  }
  /** Whether this bot wrote it, and so can edit it. */
  get editable() {
    return this.author.id === this.client.user?.id;
  }
  /** Reply in the same channel, quoting this message. */
  reply(options: MessageOptions): Promise<Message> {
    const o = typeof options === "string" ? { content: options } : options;
    return this.channel.send({ ...o, replyTo: this });
  }
  /** Change this message — only the bot's own can be edited. */
  async edit(changes: { content?: string; embeds?: EmbedLike[]; components?: RowLike[] }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (changes.content !== undefined) body.content = changes.content;
    if (changes.embeds) body.embeds = changes.embeds.map((e) => toJSON<APIEmbed>(e));
    if (changes.components) body.components = changes.components.map((r) => toJSON<APIActionRow>(r));
    await this.client.rest.patch(`/channels/${this.channel.id}/messages/${this.id}`, body);
  }
  /** Needs "Manage messages" unless the bot wrote it. */
  async delete(): Promise<void> {
    await this.client.rest.delete(`/channels/${this.channel.id}/messages/${this.id}`);
  }
  /** `message.react("👍")`, or a custom emoji's `<:name:id>`. Needs "Send messages". */
  async react(emoji: string | Emoji): Promise<void> {
    await this.client.rest.put(`/channels/${this.channel.id}/messages/${this.id}/reactions/${encodeURIComponent(typeof emoji === "string" ? emoji : emoji.mention)}`);
  }
  /** Take the bot's own reaction back. */
  async unreact(emoji: string | Emoji): Promise<void> {
    await this.client.rest.delete(`/channels/${this.channel.id}/messages/${this.id}/reactions/${encodeURIComponent(typeof emoji === "string" ? emoji : emoji.mention)}`);
  }
  /** Remove everyone's reactions. Needs "Manage messages". */
  async clearReactions(): Promise<void> {
    await this.client.rest.delete(`/channels/${this.channel.id}/messages/${this.id}/reactions`);
  }
  /** Needs "Manage messages". */
  async pin(): Promise<void> {
    await this.client.rest.put(`/channels/${this.channel.id}/pins/${this.id}`);
  }
  /** Unpin it. Needs "Manage messages". */
  async unpin(): Promise<void> {
    await this.client.rest.delete(`/channels/${this.channel.id}/pins/${this.id}`);
  }
  /** The message as it is now. Needs the "Read messages" access. */
  fetch(): Promise<Message> {
    return this.channel.fetchMessage(this.id);
  }
}

/** A role in a community: a name, a colour and a set of permissions. */
export class Role {
  /** The role's id. */
  readonly id: string;
  /** The role's name. */
  name: string;
  /** Its colour as `#rrggbb`, or `null`. */
  color: string | null;
  /** Where it sits in the list. Higher is above. */
  position: number;
  /** Whether members with it are listed separately. */
  hoist: boolean;
  /** Whether this is the role called everyone, which every member has. */
  readonly isEveryone: boolean;
  /** Roles made by a bot's installation are managed: they can't be edited here. */
  readonly managed: boolean;
  /** What it allows. */
  permissions: Permissions;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param community The community it is in.
   * @internal
   */
  constructor(readonly client: Client, readonly community: Community, data: APIRole) {
    this.id = data.id;
    this.name = data.name;
    this.color = data.color;
    this.position = data.position;
    this.hoist = data.hoist;
    this.isEveryone = data.isEveryone;
    this.managed = data.managed;
    this.permissions = new Permissions(data.permissions);
  }
  /** A mention (`<@&id>`), which appears as the role's name in a message. */
  toString() {
    return roleMention(this.id);
  }
  /** Needs "Manage roles", the role below the bot's own, and only permissions the bot holds. */
  async edit(changes: { name?: string; color?: string | null; hoist?: boolean; permissions?: number | Permissions }): Promise<this> {
    const body: Record<string, unknown> = { ...changes, permissions: changes.permissions === undefined ? undefined : typeof changes.permissions === "number" ? changes.permissions : changes.permissions.bits };
    await this.client.rest.patch(`/roles/${this.id}`, body);
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.color !== undefined) this.color = changes.color;
    if (changes.hoist !== undefined) this.hoist = changes.hoist;
    if (changes.permissions !== undefined) this.permissions = new Permissions(typeof changes.permissions === "number" ? changes.permissions : changes.permissions.bits);
    return this;
  }
  /** Delete the role. Needs "Manage roles", and the role has to be below the bot's own. */
  async delete(): Promise<void> {
    await this.client.rest.delete(`/roles/${this.id}`);
  }
}

/** A custom emoji that a community added. */
export class Emoji {
  /** The emoji's id. */
  readonly id: string;
  /** Its name, as written between the colons. */
  readonly name: string;
  /** Where its picture is. */
  readonly imageUrl: string;
  /** Write this into a message to use the emoji. */
  readonly mention: string;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param community The community it belongs to.
   * @internal
   */
  constructor(readonly client: Client, readonly community: Community, data: APIEmoji) {
    this.id = data.id;
    this.name = data.name;
    this.imageUrl = data.imageUrl;
    this.mention = data.mention;
  }
  /** Its `mention` form, so it works in a template string. */
  toString() {
    return this.mention;
  }
  /** Needs "Manage emojis and sounds". */
  async delete(): Promise<void> {
    await this.client.rest.delete(`/communities/${this.community.id}/emojis/${this.id}`);
  }
}

/** A soundboard clip. In voice, `connection.playSound(sound)` plays it for everyone there. */
export class Sound {
  /** The clip's id. */
  readonly id: string;
  /** The clip's name. */
  readonly name: string;
  /** The emoji shown with it, or `null`. */
  readonly emoji: string | null;
  /** Where its audio is. */
  readonly url: string;
  /** How long it plays, in milliseconds, or `null`. */
  readonly durationMs: number | null;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param community The community it belongs to.
   * @internal
   */
  constructor(readonly client: Client, readonly community: Community, data: APISound) {
    this.id = data.id;
    this.name = data.name;
    this.emoji = data.emoji;
    this.url = data.soundUrl;
    this.durationMs = data.durationMs;
  }
  /** Needs "Manage emojis and sounds". */
  async delete(): Promise<void> {
    await this.client.rest.delete(`/communities/${this.community.id}/sounds/${this.id}`);
  }
}

/** A person in a community: a `User` plus what they are *here*: their nickname, roles, and when they joined. */
export class Member extends User {
  /** When they joined. */
  readonly joinedAt: Date;
  /** Their nickname in this community, or `null`. */
  nickname: string | null = null;
  /** The ids of their roles. */
  roleIds: string[] = [];
  /** Whether they own the community. */
  readonly isOwner: boolean;
  /**
   * @param community The community this is about.
   * @internal
   */
  constructor(readonly community: Community, data: APIMember | APIMemberDetail) {
    super(community.client, data);
    this.joinedAt = new Date(data.joinedAt);
    const d = data as Partial<APIMemberDetail>;
    this.nickname = d.nickname ?? null;
    this.roleIds = d.roleIds ?? [];
    this.isOwner = !!d.isOwner;
  }
  /** Their nickname if they have one, otherwise their name. */
  get displayName() {
    return this.nickname ?? this.name;
  }
  /** Their roles, once the community's roles have been fetched. */
  get roles(): Role[] {
    return this.roleIds.map((id) => this.community.roles.cache.get(id)).filter((r): r is Role => !!r);
  }
  /** Needs "Remove members", and they must be below the bot's role. */
  kick(): Promise<void> {
    return this.community.kick(this);
  }
  /** Needs "Ban members", and they must be below the bot's role. */
  ban(reason?: string): Promise<void> {
    return this.community.ban(this, reason);
  }
  /** Stop them talking for a while (0 ends it). Needs "Time members out". */
  timeout(seconds: number): Promise<void> {
    return this.community.timeout(this, seconds);
  }
  /** Needs "Change nicknames" (or none, for the bot's own). */
  setNickname(nickname: string): Promise<void> {
    return this.community.setNickname(this, nickname);
  }
  /** Needs "Manage roles", a role below the bot's own, and no permissions the bot lacks. */
  async addRole(role: Role | string): Promise<void> {
    await this.client.rest.put(`/communities/${this.community.id}/members/${this.id}/roles/${typeof role === "string" ? role : role.id}`);
  }
  /** Take a role away. Needs "Manage roles", and the role has to be below the bot's own. */
  async removeRole(role: Role | string): Promise<void> {
    await this.client.rest.delete(`/communities/${this.community.id}/members/${this.id}/roles/${typeof role === "string" ? role : role.id}`);
  }
}

/** A community the bot is in, and what it may do there. Its channels, members, roles, emojis and sounds, and moderation, all hang off this. `client.communities` has one for each place the bot has been added. */
export class Community {
  /** What this bot was granted here, and what it can do right now (cut down to what the member who authorised it can still do). */
  granted = new Permissions(0);
  /** What it can do **right now**: its grant, cut down to what the person who authorised it can still do. */
  permissions = new Permissions(0);
  /** The access it was given: `messages.read`, `members.read` and/or `dm.send`. */
  scopes: string[] = [];
  /** Whether it can act here at all. If not, `inactiveReason` says why. */
  active = true;
  /** Why it can't act here, when `active` is false. */
  inactiveReason: string | null = null;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param id The community's id.
   * @param name Its name.
   * @internal
   */
  constructor(readonly client: Client, readonly id: string, public name: string) {}
  /**
   * Apply fresh data about what the bot was granted.
   * @internal
   */
  update(data: { granted: number; effective: number; scopes: string[]; active: boolean; reason: string | null }) {
    this.granted = new Permissions(data.granted);
    this.permissions = new Permissions(data.effective);
    this.scopes = data.scopes;
    this.active = data.active;
    this.inactiveReason = data.reason;
  }
  /** The community's name. */
  toString() {
    return this.name;
  }

  /** Channels the bot can see. */
  get channels() {
    const c = this;
    return {
      fetch: async (): Promise<Collection<Channel>> => {
        const res = await c.client.rest.get<{ channels: APIChannel[] }>(`/communities/${c.id}/channels`);
        const out = new Collection<Channel>();
        for (const ch of res.channels) out.set(ch.id, c.client.channelFor(ch.id, c.id, ch));
        return out;
      },
      /** Needs "Manage channels". */
      create: async (options: { name: string; type?: "text" | "voice"; topic?: string; categoryId?: string }): Promise<Channel> => {
        const { id } = await c.client.rest.post<{ id: string }>(`/communities/${c.id}/channels`, options);
        return c.client.channelFor(id, c.id, { name: options.name, type: options.type ?? "text", topic: options.topic ?? null });
      },
    };
  }

  /** Fetch the member list or one member. Needs the "See the member list" access. */
  get members() {
    const c = this;
    return {
      /** Needs the "See the member list" access. */
      fetch: async (options: { limit?: number } = {}): Promise<Collection<Member>> => {
        const res = await c.client.rest.get<{ members: APIMember[] }>(`/communities/${c.id}/members${options.limit ? `?limit=${options.limit}` : ""}`);
        const out = new Collection<Member>();
        for (const m of res.members) out.set(m.id, new Member(c, m));
        return out;
      },
      get: async (id: string): Promise<Member> => new Member(c, await c.client.rest.get<APIMemberDetail>(`/communities/${c.id}/members/${id}`)),
    };
  }

  /** Roles are cached after the first fetch so `member.roles` can resolve names. */
  readonly roles = {
    cache: new Collection<Role>(),
    /** Needs the "See the member list" access. */
    fetch: async (): Promise<Collection<Role>> => {
      const res = await this.client.rest.get<{ roles: APIRole[] }>(`/communities/${this.id}/roles`);
      this.roles.cache.clear();
      for (const r of res.roles) this.roles.cache.set(r.id, new Role(this.client, this, r));
      return this.roles.cache;
    },
    /** Needs "Manage roles". The new role sits just below the bot's own and can carry only permissions the bot holds. */
    create: async (options: { name: string; color?: string; hoist?: boolean; permissions?: number | Permissions }): Promise<Role> => {
      const { id } = await this.client.rest.post<{ id: string }>(`/communities/${this.id}/roles`, { ...options, permissions: options.permissions === undefined ? undefined : typeof options.permissions === "number" ? options.permissions : options.permissions.bits });
      const role = new Role(this.client, this, { id, name: options.name, color: options.color ?? null, permissions: typeof options.permissions === "number" ? options.permissions : (options.permissions?.bits ?? 0), position: 0, hoist: !!options.hoist, isEveryone: false, managed: false });
      this.roles.cache.set(id, role);
      return role;
    },
  };

  /** The community's custom emojis: `fetch()` them, or `create()` one. */
  readonly emojis = {
    fetch: async (): Promise<Collection<Emoji>> => {
      const res = await this.client.rest.get<{ emojis: APIEmoji[] }>(`/communities/${this.id}/emojis`);
      const out = new Collection<Emoji>();
      for (const e of res.emojis) out.set(e.id, new Emoji(this.client, this, e));
      return out;
    },
    /** Needs "Manage emojis and sounds". A PNG, JPEG, WebP or GIF up to 256 KB. */
    create: async (options: { name: string; image: FileInput }): Promise<Emoji> => {
      const file = await readFileInput(options.image);
      const storageId = await this.client.rest.upload(file.bytes, file.contentType);
      return new Emoji(this.client, this, await this.client.rest.post<APIEmoji>(`/communities/${this.id}/emojis`, { name: options.name, storageId }));
    },
  };

  /** The community's soundboard: `fetch()` the clips, or `create()` one. */
  readonly sounds = {
    fetch: async (): Promise<Collection<Sound>> => {
      const res = await this.client.rest.get<{ sounds: APISound[] }>(`/communities/${this.id}/sounds`);
      const out = new Collection<Sound>();
      for (const s of res.sounds) out.set(s.id, new Sound(this.client, this, s));
      return out;
    },
    /** Needs "Manage emojis and sounds". Audio up to 8 seconds. */
    create: async (options: { name: string; audio: FileInput; emoji?: string; durationMs?: number }): Promise<Sound> => {
      const file = await readFileInput(options.audio);
      const storageId = await this.client.rest.upload(file.bytes, file.contentType);
      const r = await this.client.rest.post<{ id: string; name: string; soundUrl: string }>(`/communities/${this.id}/sounds`, { name: options.name, emoji: options.emoji, durationMs: options.durationMs, storageId });
      return new Sound(this.client, this, { id: r.id, name: r.name, emoji: options.emoji ?? null, soundUrl: r.soundUrl, durationMs: options.durationMs ?? null });
    },
  };

  /** The banned. Needs "Ban members". */
  async fetchBans(): Promise<{ user: User | null; reason: string | null; bannedAt: Date }[]> {
    const res = await this.client.rest.get<{ bans: APIBan[] }>(`/communities/${this.id}/bans`);
    return res.bans.map((b) => ({ user: b.user ? new User(this.client, b.user) : null, reason: b.reason, bannedAt: new Date(b.bannedAt) }));
  }
  /** Ban someone (an id, a `User` or a `Member`), with an optional reason. Needs "Ban members", and they have to be below the bot's role. */
  async ban(user: string | User, reason?: string): Promise<void> {
    await this.client.rest.put(`/communities/${this.id}/bans/${typeof user === "string" ? user : user.id}`, { reason });
  }
  /** Lift a ban. Needs "Ban members". */
  async unban(user: string | User): Promise<void> {
    await this.client.rest.delete(`/communities/${this.id}/bans/${typeof user === "string" ? user : user.id}`);
  }
  /** Remove someone from the community. Needs "Remove members", and they have to be below the bot's role. */
  async kick(user: string | User): Promise<void> {
    await this.client.rest.delete(`/communities/${this.id}/members/${typeof user === "string" ? user : user.id}`);
  }
  /** Stop someone talking for `seconds` (0 ends a timeout; at most 28 days). Needs "Time members out". */
  async timeout(user: string | User, seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0) throw new CrystalError("A timeout is a number of seconds, 0 or more.");
    await this.client.rest.put(`/communities/${this.id}/members/${typeof user === "string" ? user : user.id}/timeout`, { seconds });
  }
  /** Set someone's nickname here. Needs "Change nicknames". */
  async setNickname(user: string | User, nickname: string): Promise<void> {
    await this.client.rest.patch(`/communities/${this.id}/members/${typeof user === "string" ? user : user.id}`, { nickname });
  }
  /** The community's invite code. Needs "Create invites". */
  async fetchInvite(): Promise<string> {
    return (await this.client.rest.post<{ code: string }>(`/communities/${this.id}/invites`)).code;
  }
}

/** Someone running one of your bot's slash commands. */
export class CommandInteraction {
  /** Always `"command"`, to tell it from a button press. */
  readonly type = "command" as const;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param commandName The command's name, without the /.
   * @param args Everything typed after the command name.
   * @param user Who ran it.
   * @param channel Where they ran it.
   * @param community The community it was run in.
   * @internal
   */
  constructor(readonly client: Client, readonly commandName: string, /** Everything typed after the command name. */ readonly args: string, readonly user: User, readonly channel: Channel, readonly community: Community | undefined) {}
  /** True for a command (and narrows the type to `CommandInteraction`). */
  isCommand(): this is CommandInteraction {
    return true;
  }
  /** False: this is a command. */
  isButton(): false {
    return false;
  }
  /** The arguments split on spaces, keeping "quoted phrases" together: `/roll 2 "big dice"` → `["2", "big dice"]`. */
  get argv(): string[] {
    return [...this.args.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  }
  /** Say something in the channel the command was run in. */
  reply(options: MessageOptions): Promise<Message> {
    return this.channel.send(options);
  }
}

/** Someone pressing a button on one of your bot's messages. */
export class ButtonInteraction {
  /** Always `"button"`, to tell it from a command. */
  readonly type = "button" as const;
  /**
   * @param client The client this came from, which it uses to make requests.
   * @param customId The `customId` of the button that was pressed.
   * @param messageId The message the button is on.
   * @param user Who pressed it.
   * @param channel The channel it is in.
   * @param community The community it is in.
   * @internal
   */
  constructor(readonly client: Client, readonly customId: string, readonly messageId: string, readonly user: User, readonly channel: Channel, readonly community: Community | undefined) {}
  /** False: this is a button press. */
  isCommand(): false {
    return false;
  }
  /** True for a button press (and narrows the type to `ButtonInteraction`). */
  isButton(): this is ButtonInteraction {
    return true;
  }
  /** Say something in the channel. */
  reply(options: MessageOptions): Promise<Message> {
    return this.channel.send(options);
  }
  /** Change the message the button is on — for "Done ✓", or to disable the button. It's the bot's own message, so this always works. */
  async update(changes: { content?: string; embeds?: EmbedLike[]; components?: RowLike[] }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (changes.content !== undefined) body.content = changes.content;
    if (changes.embeds) body.embeds = changes.embeds.map((e) => toJSON<APIEmbed>(e));
    if (changes.components) body.components = changes.components.map((r) => toJSON<APIActionRow>(r));
    await this.client.rest.patch(`/channels/${this.channel.id}/messages/${this.messageId}`, body);
  }
}
/** A slash command or a button press. `interaction.isCommand()` and `isButton()` tell them apart. */
export type Interaction = CommandInteraction | ButtonInteraction;
