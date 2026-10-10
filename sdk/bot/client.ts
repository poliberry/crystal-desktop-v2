import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { Emitter } from "./emitter";
import { CrystalAPIError, CrystalError } from "./errors";
import { checkButton, checkCommand, checkEvent, findDuplicate, HANDLER_FOLDERS, importDefault, listHandlerFiles, type CommandHandler, type LoadedHandlers } from "./handlers";
import { inviteUrl, type InviteOptions } from "./invite";

/** Where the Bot API is. Only needs changing to point at a preview or self-hosted deployment. */
export const DEFAULT_API_URL = "https://api.usecrystal.app/bot/v1";
import type { PresenceOptions } from "./presence";
import { REST } from "./rest";
import { verifySignature } from "./signature";
import {
  ButtonInteraction,
  Channel,
  Collection,
  CommandInteraction,
  Community,
  Member,
  Message,
  Reaction,
  User,
  type Interaction,
} from "./structures";
import type { APIChannel, APIMe, CrystalEvent } from "./types";
import type { VoiceConnection } from "./voice";

/** The events a `Client` emits. Use these names with `client.on(...)`. */
export const Events = {
  /** The bot logged in. */
  Ready: "ready",
  /** The bot was added to a community. */
  CommunityCreate: "communityCreate",
  MessageCreate: "messageCreate",
  MessageUpdate: "messageUpdate",
  MessageDelete: "messageDelete",
  ReactionAdd: "reactionAdd",
  ReactionRemove: "reactionRemove",
  /** Needs the "See the member list" access. */
  MemberAdd: "memberAdd",
  MemberRemove: "memberRemove",
  ChannelCreate: "channelCreate",
  ChannelUpdate: "channelUpdate",
  ChannelDelete: "channelDelete",
  /** Someone joined or left a voice channel. */
  VoiceStateUpdate: "voiceStateUpdate",
  /** A slash command was used, or a button was pressed. */
  InteractionCreate: "interactionCreate",
  /** A problem in one of your listeners, or while handling an event. If nothing listens, it is logged. */
  Error: "error",
  Debug: "debug",
} as const;

/** What each event passes to its listener, by event name. */
export interface ClientEvents {
  /** The bot logged in. */
  ready: [client: Client];
  /** The bot was added to a community. */
  communityCreate: [community: Community];
  /** A message was sent. */
  messageCreate: [message: Message];
  /** A message was edited. */
  messageUpdate: [message: Message];
  /** A message was deleted. Only its ids are known. */
  messageDelete: [deleted: { id: string; channelId: string; communityId: string }];
  /** A reaction was added. */
  reactionAdd: [reaction: Reaction];
  /** A reaction was removed. */
  reactionRemove: [reaction: Reaction];
  /** Someone joined a community. Needs the `members.read` access. */
  memberAdd: [member: Member];
  /** Someone left a community. Needs the `members.read` access. */
  memberRemove: [member: Member];
  /** A channel was created. */
  channelCreate: [channel: Channel];
  /** A channel was changed. */
  channelUpdate: [channel: Channel];
  /** A channel was deleted. */
  channelDelete: [channel: Channel];
  /** Someone joined or left a voice channel. */
  voiceStateUpdate: [change: { channel: Channel; user: User; action: "joined" | "left" }];
  /** A slash command was used or a button was pressed. Check `interaction.isCommand()` or `isButton()`. */
  interactionCreate: [interaction: Interaction];
  /** A problem in one of your listeners, or while handling an event. If nothing listens, it is logged. */
  error: [error: unknown];
  /** Diagnostic messages from the SDK. */
  debug: [message: string];
}

/** Settings for a `Client`. Everything has a default, so `new Client()` works. */
export interface ClientOptions {
  /** The bot's token. Default: `process.env.CRYSTAL_BOT_TOKEN`. */
  token?: string;
  /** Verifies that events really come from Crystal. Default: `process.env.CRYSTAL_SIGNING_SECRET`. */
  signingSecret?: string;
  /** Crystal's Bot API address, ending in /bot/v1. Default: `process.env.CRYSTAL_API_URL`, else Crystal's own (https://api.usecrystal.app/bot/v1). */
  apiUrl?: string;
  /** Where `listen()` serves, default `process.env.PORT` or 3000. */
  port?: number;
  /** The address `listen()` binds to. Default: all addresses. */
  host?: string;
  /** Only requests to this path are events. Default: any path. */
  path?: string;
  /** Shown as soon as the bot logs in. */
  presence?: PresenceOptions;
  /**
   * Keep the bot shown as online by telling Crystal every 30 seconds that it is alive (a bot has no
   * open app to do that). Default true. Turn off only if you manage presence yourself.
   */
  keepAlive?: boolean;
  /**
   * How the bot hears about things. `"poll"` (the default): after `login()` the SDK asks Crystal for
   * events, so a bot works from anywhere, with no address of its own, and `listen()` isn't needed.
   * `"webhook"`: Crystal calls the endpoint set in the project settings and you call `listen()`
   * (or `handleWebhook()`). A bot that has an endpoint set is called whatever this says, and the SDK
   * stops asking as soon as it is told so.
   */
  events?: "poll" | "webhook";
}

/** A bounded set of recently seen ids, so a retried delivery isn't handled twice. */
class Recent {
  private ids = new Set<string>();
  seen(id: string): boolean {
    if (this.ids.has(id)) return true;
    this.ids.add(id);
    if (this.ids.size > 2000) this.ids.delete(this.ids.values().next().value as string);
    return false;
  }
}

const MAX_BODY = 1024 * 1024;

/**
 * The connection to Crystal. Log in, listen for events, and act through the classes it hands you.
 *
 * ```ts
 * const client = new Client();
 * client.on(Events.MessageCreate, async (m) => { if (m.content === "ping") await m.reply("pong"); });
 * await client.login();
 * await client.listen();
 * ```
 *
 * Crystal calls your bot (it is not a socket your bot holds open): `listen()` starts a small web
 * server for that, or pass requests from your own framework to `handleWebhook()`.
 */
export class Client extends Emitter<ClientEvents> {
  /** The HTTP layer, for anything the classes don't cover. */
  readonly rest: REST;
  /** The bot's own account. `null` until `login()` has finished. */
  user: User | null = null;
  /** The bot's id for the API. `client.user.id` is its account id, the author of its messages. */
  botId = "";
  /** The communities the bot is in, by id. */
  readonly communities = new Collection<Community>();
  /** Channels the bot has seen, by id. */
  readonly channels = new Collection<Channel>();
  /** The voice channels the bot is connected to, by channel id. */
  readonly voice = new Map<string, VoiceConnection>();

  private readonly signingSecret: string | undefined;
  private readonly commands = new Map<string, (i: CommandInteraction) => unknown>();
  private readonly buttons = new Map<string, (i: ButtonInteraction) => unknown>();
  /** The commands `loadHandlers` found, for `registerCommands()`. */
  private readonly loaded: CommandHandler[] = [];
  private readonly recent = new Recent();
  private server: Server | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private presence: PresenceOptions;
  private loggedIn = false;
  private polling: { stop: boolean; abort: AbortController } | null = null;

  /** Make a client. The token and signing secret default to the `CRYSTAL_BOT_TOKEN` and `CRYSTAL_SIGNING_SECRET` environment variables. */
  constructor(
    /** The options this client was made with. */
    readonly options: ClientOptions = {},
  ) {
    super();
    const token = options.token ?? process.env.CRYSTAL_BOT_TOKEN;
    const apiUrl = options.apiUrl ?? (process.env.CRYSTAL_API_URL || DEFAULT_API_URL);
    if (!token) throw new CrystalError("No bot token. Pass { token } or set CRYSTAL_BOT_TOKEN.");
    this.signingSecret = options.signingSecret ?? process.env.CRYSTAL_SIGNING_SECRET;
    this.rest = new REST({ token, apiUrl });
    this.presence = options.presence ?? {};
  }

  protected override onError(error: unknown, event: string): void {
    if (event !== "error" && this.emitError(error)) return;
    if (event === "error") console.error("[crystal] unhandled error:", error);
    else console.error(`[crystal] a listener for “${event}” failed:`, error);
  }
  private emitError(error: unknown): boolean {
    return this.emit("error", error);
  }

  /** Find the cached channel or make one. */
  channelFor(id: string, communityId: string | null, data?: Partial<APIChannel>): Channel {
    let c = this.channels.get(id);
    if (!c) {
      c = new Channel(this, id, communityId, data);
      this.channels.set(id, c);
    } else if (data) c.update(data);
    return c;
  }

  /** Check the token, load the communities the bot is in, show it online, and emit `ready`. */
  async login(): Promise<this> {
    const me = await this.rest.get<APIMe>("/me");
    this.botId = me.id;
    this.user = new User(this, { id: me.userId, username: me.username, name: me.name, isBot: true });
    this.communities.clear();
    for (const c of me.communities) {
      const community = new Community(this, c.id, c.name);
      community.update(c);
      this.communities.set(c.id, community);
    }
    this.loggedIn = true;
    await this.setPresence({ status: "online", ...this.presence });
    if (this.options.keepAlive !== false) {
      this.beat = setInterval(() => {
        this.setPresence({}).catch((e) => this.emit("debug", `presence heartbeat failed: ${(e as Error).message}`));
      }, 30_000);
      this.beat.unref?.();
    }
    this.emit("ready", this);
    if (this.options.events !== "webhook") this.startPolling();
    return this;
  }

  /**
   * Ask Crystal for events, over and over, each ask waiting up to 25 seconds for something to happen.
   * Stops by itself when Crystal says the bot has an endpoint (events are pushed there instead), and
   * on `destroy()`. A failed ask backs off (2 s, doubling to 30 s) rather than hammering.
   */
  private startPolling(): void {
    if (this.polling) return;
    const state = { stop: false, abort: new AbortController() };
    this.polling = state;
    void (async () => {
      let cursor: number | undefined;
      let delay = 2000;
      while (!state.stop) {
        try {
          const q = new URLSearchParams({ wait: "25" });
          if (cursor !== undefined) q.set("after", String(cursor));
          const res = await this.rest.get<{ mode: "poll" | "webhook"; events: CrystalEvent[]; cursor: number }>(`/events?${q}`, state.abort.signal);
          delay = 2000;
          cursor = res.cursor;
          if (res.mode === "webhook") {
            this.emit("debug", "this bot has an endpoint, so events are pushed to it; no longer asking");
            break;
          }
          for (const event of res.events) await this.dispatch(event).catch((e) => this.emit("error", e));
        } catch (e) {
          if (state.stop) break;
          // A wrong or replaced token won't fix itself: say so once, and stop.
          if (e instanceof CrystalAPIError && (e.status === 401 || e.status === 403)) {
            this.emit("error", e);
            break;
          }
          this.emit("debug", `asking for events failed (${(e as Error).message}); trying again in ${delay / 1000}s`);
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(30_000, delay * 2);
        }
      }
      if (this.polling === state) this.polling = null;
    })();
  }

  /** Set the bot's status, activities and custom line. Whatever you leave out stays as it was. */
  async setPresence(next: PresenceOptions): Promise<void> {
    this.presence = { ...this.presence, ...next };
    await this.rest.put("/presence", {
      ...(next.status ? { status: next.status } : {}),
      ...(next.activities ? { activities: next.activities } : {}),
      ...(next.customStatus !== undefined ? { customStatus: next.customStatus } : {}),
    });
  }

  /** The link that adds this bot to a community (after `login()`). See `inviteUrl`. */
  inviteUrl(options: InviteOptions = {}): string {
    if (!this.botId) throw new CrystalError("Log in first: the invite link names the bot.");
    return inviteUrl(this.botId, options);
  }

  /**
   * Tell Crystal which slash commands the bot has. They then appear when people type "/". With no
   * argument it registers the commands found by `loadHandlers()`.
   */
  async registerCommands(commands: { name: string; description: string }[] = this.loaded.map((c) => ({ name: c.name, description: c.description }))): Promise<void> {
    await this.rest.put("/commands", { commands });
  }

  /**
   * Find the handlers in files and wire them up: every file under `events/`, `commands/` and `buttons/` in `dir`
   * whose default export is made with `defineEvent`, `defineCommand` or `defineButton`.
   *
   * ```ts
   * await client.loadHandlers(new URL(".", import.meta.url)); // the folder this file is in
   * await client.login();
   * await client.registerCommands();                          // the ones that were found
   * ```
   *
   * Files starting with `_` or `.`, type files and tests are skipped, so a helper can live beside the handlers.
   * Two commands with one name, or two buttons with one id, are an error that names both files. Call it before
   * `login()` so nothing is missed. Returns what it found.
   */
  async loadHandlers(dir: string | URL): Promise<LoadedHandlers> {
    const root = typeof dir === "string" ? dir : (await import("node:url")).fileURLToPath(dir);
    const found: LoadedHandlers = { events: [], commands: [], buttons: [], files: [] };
    const load = async <T>(folder: string, check: (v: unknown, file: string) => T): Promise<{ value: T; file: string }[]> => {
      const out: { value: T; file: string }[] = [];
      for (const rel of await listHandlerFiles(root, folder)) {
        out.push({ value: check(await importDefault(root, rel), rel), file: rel });
        found.files.push(rel);
      }
      return out;
    };
    const known = Object.keys(Events).map((k) => Events[k as keyof typeof Events]) as string[];
    const events = await load(HANDLER_FOLDERS.events, (v, f) => checkEvent(v, f, known));
    const commands = await load(HANDLER_FOLDERS.commands, checkCommand);
    const buttons = await load(HANDLER_FOLDERS.buttons, checkButton);
    const dupCommand = findDuplicate(commands, (c) => c.name);
    if (dupCommand) throw new CrystalError(`The command “${dupCommand.key}” is defined twice: in “${dupCommand.a}” and “${dupCommand.b}”.`);
    const dupButton = findDuplicate(buttons, (b) => b.customId);
    if (dupButton) throw new CrystalError(`The button “${dupButton.key}” is handled twice: in “${dupButton.a}” and “${dupButton.b}”.`);

    for (const { value: h } of events) {
      const listener = (...args: unknown[]) => (h.run as (...a: unknown[]) => unknown)(...args, this);
      if (h.once) this.once(h.name, listener as never);
      else this.on(h.name, listener as never);
      found.events.push(h);
    }
    for (const { value: c } of commands) {
      this.command(c.name, (i) => c.run(i, this));
      this.loaded.push(c);
      found.commands.push(c);
    }
    for (const { value: b } of buttons) {
      this.button(b.customId, (i) => b.run(i, this));
      found.buttons.push(b);
    }
    return found;
  }

  /** Handle a slash command: `client.command("roll", (i) => i.reply("4"))`. */
  command(name: string, handler: (interaction: CommandInteraction) => unknown): this {
    this.commands.set(name.toLowerCase(), handler);
    return this;
  }

  /** Handle a button by its customId: `client.button("yes", (i) => i.update({ content: "Done" }))`. */
  button(customId: string, handler: (interaction: ButtonInteraction) => unknown): this {
    this.buttons.set(customId, handler);
    return this;
  }

  // --- Receiving events ---------------------------------------------------------------------------

  /**
   * Verify and handle one request from Crystal. For use with your own server or framework:
   * pass the exact raw body and the `x-crystal-signature` header. Answers with the status to send.
   */
  handleWebhook(rawBody: string, signature: string | undefined): number {
    if (!this.signingSecret) {
      this.emit("error", new CrystalError("Can't verify events: no signing secret. Set CRYSTAL_SIGNING_SECRET."));
      return 500;
    }
    if (!verifySignature(this.signingSecret, signature, rawBody)) return 401;
    let event: CrystalEvent;
    try {
      event = JSON.parse(rawBody) as CrystalEvent;
    } catch {
      return 400;
    }
    // Answered now, handled after: Crystal waits only a few seconds, then retries.
    queueMicrotask(() => {
      this.dispatch(event).catch((e) => this.emit("error", e));
    });
    return 200;
  }

  /** Start a small web server for Crystal's events. Returns once it is listening. */
  listen(port = this.options.port ?? Number(process.env.PORT ?? 3000)): Promise<Server> {
    if (this.server) return Promise.resolve(this.server);
    const server = createServer((req, res) => void this.serve(req, res));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, this.options.host, () => resolve(server));
    });
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && url === "/health") return void res.writeHead(200).end("ok");
    if (req.method !== "POST" || (this.options.path && url !== this.options.path)) return void res.writeHead(404).end();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Uint8Array).length;
      if (size > MAX_BODY) return void res.writeHead(413).end();
      chunks.push(chunk as Uint8Array);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    res.writeHead(this.handleWebhook(body, req.headers["x-crystal-signature"] as string | undefined)).end();
  }

  private memberOf(communityId: string, u: { id: string; username: string; name: string; isBot?: boolean }): Member {
    const community = this.communities.get(communityId) ?? new Community(this, communityId, "");
    return new Member(community, { ...u, isBot: !!u.isBot, joinedAt: Date.now() });
  }

  /** Turn an event into the right classes and emit. Public so tests (and unusual setups) can feed events in. */
  async dispatch(event: CrystalEvent): Promise<void> {
    if (this.recent.seen(event.id)) return;
    this.emit("debug", `event ${event.type}`);
    switch (event.type) {
      case "ping":
        return;
      case "bot.installed": {
        // The community is new to this client: refresh what it was granted.
        await this.login().catch(() => undefined);
        const c = this.communities.get(event.communityId) ?? new Community(this, event.communityId, event.communityName);
        this.emit("communityCreate", c);
        return;
      }
      case "message.created": {
        const ch = this.channelFor(event.channelId, event.communityId);
        this.emit("messageCreate", new Message(this, ch, event.message));
        return;
      }
      case "message.updated":
        return void this.emit("messageUpdate", new Message(this, this.channelFor(event.channelId, event.communityId), event.message));
      case "message.deleted":
        return void this.emit("messageDelete", { id: event.messageId, channelId: event.channelId, communityId: event.communityId });
      case "reaction.added":
      case "reaction.removed": {
        const r = new Reaction(this, event.channelId, event.messageId, event.emoji, new User(this, event.user));
        this.channelFor(event.channelId, event.communityId);
        return void this.emit(event.type === "reaction.added" ? "reactionAdd" : "reactionRemove", r);
      }
      case "member.joined":
        return void this.emit("memberAdd", this.memberOf(event.communityId, event.member));
      case "member.left":
        return void this.emit("memberRemove", this.memberOf(event.communityId, event.member));
      case "channel.created":
      case "channel.updated":
      case "channel.deleted": {
        const ch = this.channelFor(event.channel.id, event.communityId, { name: event.channel.name, type: event.channel.type, topic: event.channel.topic });
        const name = event.type === "channel.created" ? "channelCreate" : event.type === "channel.updated" ? "channelUpdate" : "channelDelete";
        this.emit(name, ch);
        if (event.type === "channel.deleted") this.channels.delete(ch.id);
        return;
      }
      case "voice.state":
        return void this.emit("voiceStateUpdate", { channel: this.channelFor(event.channelId, event.communityId), user: new User(this, event.user), action: event.action });
      case "interaction.command": {
        const i = new CommandInteraction(this, event.command, event.args, new User(this, event.user), this.channelFor(event.channelId, event.communityId), this.communities.get(event.communityId));
        const handler = this.commands.get(event.command);
        if (handler) {
          try {
            await handler(i);
          } catch (e) {
            this.emit("error", e);
          }
        }
        this.emit("interactionCreate", i);
        return;
      }
      case "interaction.button": {
        const i = new ButtonInteraction(this, event.customId, event.messageId, new User(this, event.user), this.channelFor(event.channelId, event.communityId), this.communities.get(event.communityId));
        const handler = this.buttons.get(event.customId);
        if (handler) {
          try {
            await handler(i);
          } catch (e) {
            this.emit("error", e);
          }
        }
        this.emit("interactionCreate", i);
        return;
      }
    }
  }

  /** Leave voice, stop the web server and the heartbeat, and show the bot offline. */
  async destroy(): Promise<void> {
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    if (this.polling) {
      this.polling.stop = true;
      this.polling.abort.abort();
      this.polling = null;
    }
    for (const v of [...this.voice.values()]) await v.disconnect().catch(() => undefined);
    if (this.loggedIn) await this.rest.put("/presence", { status: "invisible" }).catch(() => undefined);
    this.loggedIn = false;
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }
}
