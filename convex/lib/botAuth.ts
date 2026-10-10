import { PERMISSIONS } from "../permissions";

/**
 * How a bot gets its authority, and how it proves who it is. Pure functions — nothing here reads
 * the database — so every rule below can be tested on its own and read in one place.
 *
 * The model, in one paragraph: a bot is an account that a *person with Manage Integrations* adds
 * to a community. That person chooses which of the bot's requested permissions to grant, and can
 * only grant ones they hold themselves. The grant is a role on the bot. And the bot's authority
 * stays tied to the person who gave it: whenever the bot acts, what it can do is the intersection
 * of its role and what its authorising member can still do. If they leave, are banned, or are
 * demoted, the bot loses exactly what they lost — straight away, with nothing to clean up.
 */

// --- What a bot may ever hold ----------------------------------------------------------------

export interface BotPermissionInfo {
  key: keyof typeof PERMISSIONS;
  bit: number;
  label: string;
  /** Said in plain words on the consent screen. */
  description: string;
  risk: "low" | "medium" | "high";
}

/**
 * The community permissions a bot can request or be given.
 *
 * As wide as a Discord bot's, with the lines drawn where a bot could otherwise raise its own
 * authority or reach past the community:
 *
 *  - **Never on the list**, for anyone including the owner: Administrator, Manage Community (the
 *    community's own settings and deletion), Manage Integrations (a bot installing bots would be a
 *    ladder), Manage Game Servers (it holds panel credentials) and Manage Events.
 *  - **Everything on the list is delegated, not owned.** A bot's powers are the intersection of its
 *    grant and what the member who authorised it can still do, and the powers that make things —
 *    roles, channel overwrites — can only make things no stronger than the bot itself
 *    (see `grantableToRole`). So no chain of bot actions ends with more than someone could do directly.
 */
export const BOT_PERMISSIONS: BotPermissionInfo[] = [
  { key: "VIEW_CHANNELS", bit: PERMISSIONS.VIEW_CHANNELS, label: "See channels", description: "See the channels it has been given access to.", risk: "low" },
  { key: "SEND_MESSAGES", bit: PERMISSIONS.SEND_MESSAGES, label: "Send messages", description: "Post messages and add reactions in channels it can see.", risk: "low" },
  { key: "CONNECT", bit: PERMISSIONS.CONNECT, label: "Join voice channels", description: "Join voice channels to speak and play soundboard clips. Bots can't share video or a screen.", risk: "medium" },
  { key: "CREATE_INVITE", bit: PERMISSIONS.CREATE_INVITE, label: "Create invites", description: "Get the community's invite link.", risk: "low" },
  { key: "MENTION_EVERYONE", bit: PERMISSIONS.MENTION_EVERYONE, label: "Mention everyone", description: "Use @everyone, @here and role mentions, which notify lots of people at once.", risk: "medium" },
  { key: "MANAGE_MESSAGES", bit: PERMISSIONS.MANAGE_MESSAGES, label: "Manage messages", description: "Delete other people's messages and pin messages.", risk: "medium" },
  { key: "MANAGE_NICKNAMES", bit: PERMISSIONS.MANAGE_NICKNAMES, label: "Change nicknames", description: "Change other members' nicknames. Only members below the bot's role.", risk: "medium" },
  { key: "MANAGE_EMOJIS", bit: PERMISSIONS.MANAGE_EMOJIS, label: "Manage emojis and sounds", description: "Add and remove the community's custom emojis and soundboard clips.", risk: "medium" },
  { key: "MUTE_MEMBERS", bit: PERMISSIONS.MUTE_MEMBERS, label: "Mute members in voice", description: "Server-mute members in voice channels. Only members below the bot's role.", risk: "high" },
  { key: "DEAFEN_MEMBERS", bit: PERMISSIONS.DEAFEN_MEMBERS, label: "Deafen members in voice", description: "Server-deafen members in voice channels. Only members below the bot's role.", risk: "high" },
  { key: "MOVE_MEMBERS", bit: PERMISSIONS.MOVE_MEMBERS, label: "Disconnect members from voice", description: "Remove members from voice channels. Only members below the bot's role.", risk: "high" },
  { key: "MODERATE_MEMBERS", bit: PERMISSIONS.MODERATE_MEMBERS, label: "Time members out", description: "Stop a member from talking for a while. Only members below the bot's role.", risk: "high" },
  { key: "KICK_MEMBERS", bit: PERMISSIONS.KICK_MEMBERS, label: "Remove members", description: "Remove members from the community. Only members below the bot's role.", risk: "high" },
  { key: "BAN_MEMBERS", bit: PERMISSIONS.BAN_MEMBERS, label: "Ban members", description: "Ban and unban members. Only members below the bot's role.", risk: "high" },
  { key: "MANAGE_CHANNELS", bit: PERMISSIONS.MANAGE_CHANNELS, label: "Manage channels", description: "Create, rename and delete channels, and change who can see and use them — but never give a channel permissions the bot doesn't have.", risk: "high" },
  { key: "MANAGE_ROLES", bit: PERMISSIONS.MANAGE_ROLES, label: "Manage roles", description: "Create, edit and delete roles below the bot's own and give them to members — but never a role with permissions the bot doesn't have.", risk: "high" },
];

export const BOT_GRANTABLE = BOT_PERMISSIONS.reduce((m, p) => m | p.bit, 0);

/** Access to community data beyond what a permission allows, and other things that need their own consent. */
export const BOT_SCOPES = ["messages.read", "members.read", "dm.send"] as const;
export type BotScope = (typeof BOT_SCOPES)[number];

export const BOT_SCOPE_INFO: Record<BotScope, { label: string; description: string }> = {
  "messages.read": { label: "Read messages", description: "Receive every message sent in the channels it can see, and read their history." },
  "members.read": { label: "See the member list", description: "See who is in the community, their names, roles and when they joined, and be told when people join or leave." },
  "dm.send": { label: "Send direct messages", description: "Message a member privately — but only someone who has just used one of its commands or buttons, and only for a short while after." },
};

const nameOf = (bit: number) => BOT_PERMISSIONS.find((p) => p.bit === bit)?.label ?? `permission ${bit}`;

// --- Holding a permission --------------------------------------------------------------------

const ALL = ~0;

/** Whether a set of permissions covers `bit`. Administrator, and the owner's all-ones, cover everything. */
export function holds(base: number, bit: number): boolean {
  return base === ALL || (base & PERMISSIONS.ADMINISTRATOR) !== 0 || (base & bit) === bit;
}

/** The bits in `wanted` that `base` doesn't hold. */
function missingFrom(base: number, wanted: number): number[] {
  return BOT_PERMISSIONS.filter((p) => (wanted & p.bit) !== 0 && !holds(base, p.bit)).map((p) => p.bit);
}

/** A request from a bot's author: only grantable bits, only known scopes. Throws, saying which, if not. */
export function validateRequest(permissions: unknown, scopes: unknown): { permissions: number; scopes: BotScope[] } {
  if (typeof permissions !== "number" || !Number.isInteger(permissions) || permissions < 0 || permissions > 0x7fffffff) {
    throw new Error("The requested permissions aren't valid.");
  }
  const illegal = permissions & ~BOT_GRANTABLE;
  if (illegal !== 0) {
    throw new Error("A bot can't ask for that permission. Bots can be given: " + BOT_PERMISSIONS.map((p) => p.label.toLowerCase()).join(", ") + ".");
  }
  if (!Array.isArray(scopes) || scopes.some((s) => typeof s !== "string" || !(BOT_SCOPES as readonly string[]).includes(s))) {
    throw new Error("The requested data access isn't valid.");
  }
  return { permissions, scopes: [...new Set(scopes as BotScope[])] };
}

/**
 * What an installer may grant: a subset of what the bot asked for, of what a bot can ever hold,
 * and of what the installer holds themselves. Anything else is an error that names what's wrong —
 * never a silent trim — because someone approving a bot should get exactly what they approved.
 */
export function computeGrant(args: { requested: number; wanted: number; authoriserBase: number; requestedScopes: readonly string[]; wantedScopes: readonly string[] }): { permissions: number; scopes: BotScope[] } {
  const { requested, wanted, authoriserBase, requestedScopes, wantedScopes } = args;
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 0x7fffffff) throw new Error("Those permissions aren't valid.");
  if ((wanted & ~BOT_GRANTABLE) !== 0) throw new Error("A bot can't be given that permission.");
  const notAsked = wanted & ~requested;
  if (notAsked !== 0) throw new Error(`This bot didn't ask for: ${BOT_PERMISSIONS.filter((p) => notAsked & p.bit).map((p) => p.label.toLowerCase()).join(", ")}.`);
  const lacking = missingFrom(authoriserBase, wanted);
  if (lacking.length) throw new Error(`You can only give a bot permissions you have yourself. You don't have: ${lacking.map((b) => nameOf(b).toLowerCase()).join(", ")}.`);
  const scopes = [...new Set(wantedScopes)];
  for (const s of scopes) {
    if (!(BOT_SCOPES as readonly string[]).includes(s)) throw new Error("That data access isn't valid.");
    if (!requestedScopes.includes(s)) throw new Error(`This bot didn't ask for: ${BOT_SCOPE_INFO[s as BotScope].label.toLowerCase()}.`);
  }
  return { permissions: wanted, scopes: scopes as BotScope[] };
}

/**
 * What a bot can do right now: its own (role + channel) permissions, cut down to what the member
 * who authorised it can still do. This is the line that makes a bot's authority theirs.
 */
export function effectivePermissions(botPermissions: number, authoriserBase: number): number {
  const bot = botPermissions & BOT_GRANTABLE;
  if (authoriserBase === ALL || (authoriserBase & PERMISSIONS.ADMINISTRATOR) !== 0) return bot;
  return bot & authoriserBase;
}

/** The bits of a grant its authoriser no longer holds, for showing "needs re-authorising". */
export function lostFromAuthoriser(granted: number, authoriserBase: number): number {
  return missingFrom(authoriserBase, granted & BOT_GRANTABLE).reduce((m, b) => m | b, 0);
}

/**
 * May a bot put these permission bits on a role or a channel overwrite?
 *
 * Only ones it holds itself, and never Administrator. That is what makes the powers that *make*
 * things safe: a bot with Manage Roles can't build a role stronger than itself and hand it to
 * anyone, and with Manage Channels can't grant a permission it lacks through an overwrite.
 * Taking bits away (`current` carries what was already there) is always fine.
 */
export function grantableToRole(botEffective: number, wanted: number, current = 0): { ok: true } | { ok: false; message: string } {
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 0x7fffffff) return { ok: false, message: "Those permissions aren't valid." };
  if ((wanted & PERMISSIONS.ADMINISTRATOR) !== 0) return { ok: false, message: "A bot can't give anything the Administrator permission." };
  const added = wanted & ~current;
  const lacking = added & ~(botEffective === ~0 ? ~0 : botEffective);
  if (lacking !== 0) return { ok: false, message: "A bot can only give permissions it has itself." };
  return { ok: true };
}

/** Whether a position (a role, or a member's highest role) is strictly below the bot's own. */
export const isBelow = (position: number, botPosition: number) => position < botPosition;

// --- Names and commands ----------------------------------------------------------------------

/** How events are delivered to a bot's endpoint (see botDelivery.ts, which reads these). */
export const BOT_DELIVERY = { timeoutMs: 5_000, backoffMs: [5_000, 30_000, 120_000, 600_000], disableAfter: 10 } as const;

/** Requests a bot may make per minute, and of those how many may be messages. */
export const BOT_RATE = { requestsPerMinute: 120, sendsPerMinute: 40 } as const;

/** What one message from a bot may carry. */
export const BOT_MESSAGE = { content: 4000, files: 4, fileBytes: 10 * 1024 * 1024 } as const;

export const BOT_LIMITS = { botsPerUser: 10, botsPerCommunity: 25, commands: 25, descriptionChars: 300, bioChars: 190 } as const;

/** Largest picture for a bot's avatar and banner, in bytes. */
export const BOT_IMAGE_BYTES = { avatar: 2 * 1024 * 1024, banner: 6 * 1024 * 1024 } as const;

export function validateBotName(name: unknown): string {
  const n = typeof name === "string" ? name.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  // eslint-disable-next-line no-control-regex
  if (n.length < 2 || n.length > 32 || /[\u0000-\u001f<>@#:`]/.test(n)) throw new Error("A bot's name is 2–32 characters, without < > @ # : or `.");
  return n;
}

export interface BotCommand {
  name: string;
  description: string;
}

export function validateCommands(input: unknown): BotCommand[] {
  if (!Array.isArray(input)) throw new Error("Commands have to be a list.");
  if (input.length > BOT_LIMITS.commands) throw new Error(`A bot can have up to ${BOT_LIMITS.commands} commands.`);
  const seen = new Set<string>();
  return input.map((raw) => {
    const c = raw as Partial<BotCommand> | null;
    const name = typeof c?.name === "string" ? c.name.trim().toLowerCase() : "";
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw new Error("A command's name is 1–32 letters, numbers, - or _.");
    if (seen.has(name)) throw new Error(`There are two commands called “${name}”.`);
    seen.add(name);
    const description = typeof c?.description === "string" ? c.description.trim() : "";
    if (description.length < 1 || description.length > 100) throw new Error(`“${name}” needs a description of up to 100 characters.`);
    return { name, description };
  });
}

// --- Tokens ----------------------------------------------------------------------------------

const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

/** Equal strings, in time that doesn't depend on where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const TOKEN = /^cbt_([a-f0-9]{10})\.([A-Za-z0-9_-]{43})$/;

/**
 * A bot token: `cbt_<id>.<secret>`. The id is public and only finds the bot; the 256-bit secret
 * is what authenticates. Only a hash of the whole token is kept, so a copy of the database can't
 * be used to act as a bot, and the token is shown to its author once.
 */
export async function generateToken(): Promise<{ token: string; prefix: string; hash: string }> {
  const id = hex(crypto.getRandomValues(new Uint8Array(5)));
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const token = `cbt_${id}.${secret}`;
  return { token, prefix: id, hash: await sha256Hex(token) };
}

/** The pieces of an `Authorization: Bot <token>` header, or null if it isn't one. */
export function parseAuthorization(header: string | null): { prefix: string; token: string } | null {
  const m = header?.match(/^Bot\s+(\S+)$/);
  const t = m?.[1]?.match(TOKEN);
  return t ? { prefix: t[1], token: m![1] } : null;
}

// --- Signed events ---------------------------------------------------------------------------

export function generateSigningSecret(): string {
  return `csk_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))));
}

/**
 * The `X-Crystal-Signature` header for an event: `t=<unix seconds>,v1=<hmac>`, over
 * `<t>.<body>`. The timestamp is inside what is signed, so a captured request can't be replayed
 * later or with a different body — a receiver rejects anything older than a few minutes.
 */
export async function signEvent(secret: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${nowSeconds},v1=${await hmacHex(secret, `${nowSeconds}.${body}`)}`;
}

export async function verifyEvent(secret: string, header: string | null, body: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const t = header?.match(/(?:^|,)t=(\d{1,12})(?:,|$)/)?.[1];
  const v1 = header?.match(/(?:^|,)v1=([a-f0-9]{64})(?:,|$)/)?.[1];
  if (!t || !v1) return false;
  if (Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;
  return constantTimeEqual(await hmacHex(secret, `${t}.${body}`), v1);
}
