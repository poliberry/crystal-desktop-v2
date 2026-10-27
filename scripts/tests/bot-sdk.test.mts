/**
 * The bot SDK against a mock Crystal API: login, signed events, the classes' calls, errors and
 * retries. Every request the SDK makes is also checked against the server's route table, so the
 * SDK can't call something the server doesn't serve.
 *
 * Run: npx tsx scripts/tests/bot-sdk.test.mts
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { matchRoute } from "../../convex/lib/botRoutes";
import { signEvent } from "../../convex/lib/botAuth";
import { ActionRowBuilder, ButtonBuilder, Client, DEFAULT_API_URL, CrystalAPIError, CrystalError, EmbedBuilder, Events, Message, verifySignature } from "../../sdk/bot/index";

let f = 0,
  p = 0;
const ok = (n: string, c: boolean, d?: unknown) => {
  c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d)));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Seen {
  method: string;
  path: string;
  auth: string | undefined;
  body: any;
}
const seen: Seen[] = [];
const eventAsks: string[] = [];
let eventsFor: unknown[] = [];
let pushMode = false;
let cursor = 100;
let throttleOnce = false;
let forbidNext = false;

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
};

const api = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname.replace(/^\/bot\/v1/, "") + url.search;
  const body = await readBody(req);
  // The SDK's background asks for events are tested on their own, and would shuffle every index below.
  if (path.startsWith("/events")) {
    eventAsks.push(path);
    const events = eventsFor.splice(0);
    if (!events.length) await sleep(150);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ mode: pushMode ? "webhook" : "poll", events, cursor: ++cursor }));
    return;
  }
  seen.push({ method: req.method ?? "", path, auth: req.headers.authorization, body });
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(data));
  };
  if (path === "/me") {
    return json(200, {
      id: "bot1",
      userId: "u_bot",
      username: "testbot",
      name: "Test Bot",
      bio: null,
      imageUrl: null,
      communities: [{ id: "c1", name: "Home", granted: 3, effective: 1, scopes: ["messages.read"], active: true, reason: null }],
    });
  }
  if (path === "/presence") return json(200, { ok: true });
  if (path === "/channels/ch1/messages" && req.method === "POST") {
    if (throttleOnce) {
      throttleOnce = false;
      return json(429, { error: { message: "Slow down." } }, { "retry-after": "0" });
    }
    if (forbidNext) {
      forbidNext = false;
      return json(403, { error: { message: "Missing permission." } });
    }
    return json(200, { id: "m_new" });
  }
  return json(200, { ok: true });
});
await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/bot/v1`;

const SECRET = "whsec_test";
const make = (extra: Record<string, unknown> = {}) => new Client({ token: "tok_123", signingSecret: SECRET, apiUrl, keepAlive: false, ...extra });
const sign = (body: string, at?: number) => signEvent(SECRET, body, at);
const msgEvent = (id: string, text: string, authorBot = false) =>
  JSON.stringify({
    id,
    type: "message.created",
    createdAt: Date.now(),
    communityId: "c1",
    channelId: "ch1",
    message: { id: "m1", text, createdAt: Date.now(), replyToId: null, attachments: [], author: { id: "u1", username: "sam", name: "Sam", isBot: authorBot } },
  });

// --- setup -------------------------------------------------------------------------------------
try {
  delete process.env.CRYSTAL_BOT_TOKEN;
  new Client({ apiUrl });
  ok("no token → clear error", false);
} catch (e) {
  ok("no token → clear error", e instanceof CrystalError && /CRYSTAL_BOT_TOKEN/.test((e as Error).message));
}
{
  delete process.env.CRYSTAL_API_URL;
  const c = new Client({ token: "x" });
  ok("with no api address the SDK uses api.usecrystal.app", (c.rest as any).options.apiUrl === "https://api.usecrystal.app/bot/v1" && DEFAULT_API_URL === "https://api.usecrystal.app/bot/v1", (c.rest as any).options.apiUrl);
  process.env.CRYSTAL_API_URL = "https://preview.example/bot/v1";
  ok("CRYSTAL_API_URL still overrides it", (new Client({ token: "x" }).rest as any).options.apiUrl === "https://preview.example/bot/v1");
  delete process.env.CRYSTAL_API_URL;
  ok("an explicit apiUrl wins over both", (new Client({ token: "x", apiUrl: "http://127.0.0.1:1/bot/v1" }).rest as any).options.apiUrl === "http://127.0.0.1:1/bot/v1");
}

// --- login -------------------------------------------------------------------------------------
const client = make({ presence: { status: "online", customStatus: "hi" } });
let ready = 0;
client.on(Events.Ready, () => ready++);
await client.login();
ok("login emits ready once", ready === 1);
ok("bot id and user are set", client.botId === "bot1" && client.user?.id === "u_bot" && client.user.isBot === true);
ok("communities loaded with permissions", client.communities.get("c1")?.name === "Home" && client.communities.get("c1")?.permissions.bits === 1 && client.communities.get("c1")?.granted.bits === 3);
ok("requests carry the bot token", seen.every((s) => s.auth === "Bot tok_123"));
ok("presence sent on login", seen.some((s) => s.method === "PUT" && s.path === "/presence" && s.body.status === "online" && s.body.customStatus === "hi"));

// --- receiving events --------------------------------------------------------------------------
const got: Message[] = [];
client.on(Events.MessageCreate, (m) => void got.push(m));
const body1 = msgEvent("evt1", "hello");
ok("bad signature → 401", client.handleWebhook(body1, "t=1,v1=" + "0".repeat(64)) === 401);
ok("missing signature → 401", client.handleWebhook(body1, undefined) === 401);
ok("stale signature → 401", client.handleWebhook(body1, await sign(body1, Math.floor(Date.now() / 1000) - 3600)) === 401);
ok("body edited after signing → 401", client.handleWebhook(body1.replace("hello", "HELLO"), await sign(body1)) === 401);
ok("nothing was handled for refused requests", got.length === 0);
ok("valid signature → 200", client.handleWebhook(body1, await sign(body1)) === 200);
await sleep(20);
ok("message arrives as a Message", got.length === 1 && got[0].content === "hello" && got[0].author.username === "sam" && got[0].channel.id === "ch1" && got[0].communityId === "c1");
ok("fromBot reflects the author", got[0].fromBot === false);
client.handleWebhook(body1, await sign(body1));
await sleep(20);
ok("a retried delivery is handled once", got.length === 1);
const body2 = msgEvent("evt2", "from a bot", true);
client.handleWebhook(body2, await sign(body2));
await sleep(20);
ok("a bot's message says fromBot", got[1]?.fromBot === true);
ok("verifySignature is exported and agrees", verifySignature(SECRET, await sign("x"), "x") && !verifySignature(SECRET, await sign("x"), "y"));

// --- the web server ----------------------------------------------------------------------------
const server = make({ port: 0, host: "127.0.0.1", path: "/events" });
const sgot: string[] = [];
server.on(Events.MessageCreate, (m) => void sgot.push(m.content));
const http = await server.listen(0);
const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
const post = async (path: string, b: string, sig?: string) => (await fetch(base + path, { method: "POST", body: b, headers: sig ? { "x-crystal-signature": sig } : {} })).status;
const b3 = msgEvent("evt3", "over http");
ok("server: signed event on the path → 200", (await post("/events", b3, await sign(b3))) === 200);
await sleep(30);
ok("server: event delivered", sgot[0] === "over http");
ok("server: unsigned → 401", (await post("/events", b3)) === 401);
ok("server: other path → 404", (await post("/other", b3, await sign(b3))) === 404);
ok("server: GET /health → 200", (await fetch(base + "/health")).status === 200);
ok("server: oversized body → 413", (await post("/events", "x".repeat(1024 * 1024 + 10), await sign("x"))) === 413);
await server.destroy();

// --- acting ------------------------------------------------------------------------------------
seen.length = 0;
const m = got[0];
const embed = new EmbedBuilder().setTitle("Pong").setColor("#ff8800").addFields({ name: "a", value: "b", inline: true });
const row = new ActionRowBuilder(new ButtonBuilder().setCustomId("yes").setLabel("Yes").setStyle("success"), new ButtonBuilder().setURL("https://example.com").setLabel("Docs"));
const sent = await m.reply({ content: "pong", embeds: [embed], components: [row] });
const post1 = seen.find((s) => s.method === "POST" && s.path === "/channels/ch1/messages");
ok("reply → POST message", !!post1);
ok("reply quotes the message", post1?.body.replyToId === "m1");
ok("embed builder serialised, colour as number", post1?.body.embeds[0].title === "Pong" && post1.body.embeds[0].color === 0xff8800 && post1.body.embeds[0].fields[0].inline === true);
ok("buttons serialised; link button has no customId", post1?.body.components[0].buttons[0].customId === "yes" && post1.body.components[0].buttons[1].style === "link" && post1.body.components[0].buttons[1].customId === undefined);
ok("reply returns the new message", sent.id === "m_new" && sent.fromBot === true && sent.editable === true);
try {
  new EmbedBuilder().setColor("orange");
  ok("bad colour refused early", false);
} catch (e) {
  ok("bad colour refused early", e instanceof CrystalError);
}

seen.length = 0;
await m.react("👍");
await m.edit({ content: "x" }).catch(() => undefined);
await m.pin();
await m.delete();
ok("react → PUT with the emoji encoded", seen[0].method === "PUT" && seen[0].path === "/channels/ch1/messages/m1/reactions/" + encodeURIComponent("👍"));
ok("edit → PATCH", seen[1].method === "PATCH" && seen[1].path === "/channels/ch1/messages/m1" && seen[1].body.content === "x");
ok("pin → PUT", seen[2].method === "PUT" && seen[2].path === "/channels/ch1/pins/m1");
ok("delete → DELETE", seen[3].method === "DELETE" && seen[3].path === "/channels/ch1/messages/m1");

seen.length = 0;
const home = client.communities.get("c1")!;
await home.ban("u9", "spam");
await home.unban("u9");
await home.kick("u9");
await home.timeout("u9", 60);
await home.setNickname("u9", "Nick");
await home.roles.create({ name: "Mod", permissions: 4 });
await client.channels.get("ch1")!.setTopic("hello");
await client.channels.get("ch1")!.bulkDelete(["a", "b"]);
await client.channels.get("ch1")!.sendTyping();
const ban = seen[0];
ok("ban → PUT with reason", ban.method === "PUT" && ban.path === "/communities/c1/bans/u9" && ban.body.reason === "spam");
ok("kick, timeout, nickname, role routes", seen[2].method === "DELETE" && seen[3].path.endsWith("/members/u9/timeout") && seen[3].body.seconds === 60 && seen[4].body.nickname === "Nick" && seen[5].body.permissions === 4);
ok("bulk delete sends ids", seen[7].body.messageIds.join() === "a,b");
try {
  await home.timeout("u9", -1);
  ok("negative timeout refused", false);
} catch (e) {
  ok("negative timeout refused", e instanceof CrystalError);
}
// Every call made so far is something the server routes, with the method it expects.
const unrouted = seen.filter((s) => {
  const r = matchRoute(s.method, s.path.split("?")[0]);
  return !(r && "matched" in r);
});
ok("every SDK request matches a server route", unrouted.length === 0, unrouted.map((s) => s.method + " " + s.path));

// --- errors and retries ------------------------------------------------------------------------
throttleOnce = true;
seen.length = 0;
await client.channels.get("ch1")!.send("after a slow-down");
ok("429 is waited out and retried", seen.filter((s) => s.path === "/channels/ch1/messages").length === 2);
forbidNext = true;
try {
  await client.channels.get("ch1")!.send("no");
  ok("403 throws", false);
} catch (e) {
  ok("403 throws a CrystalAPIError that says forbidden", e instanceof CrystalAPIError && e.isForbidden && e.status === 403 && /Missing permission/.test(e.message));
}

// --- interactions ------------------------------------------------------------------------------
const rolls: string[][] = [];
client.command("roll", (i) => {
  rolls.push(i.argv);
  return i.reply("rolled");
});
const pressed: string[] = [];
client.button("yes", async (i) => {
  pressed.push(i.user.username);
  await i.update({ content: "Done", components: [] });
});
seen.length = 0;
const cmd = JSON.stringify({ id: "evt4", type: "interaction.command", createdAt: Date.now(), communityId: "c1", channelId: "ch1", command: "roll", args: '2 "big dice"', user: { id: "u1", username: "sam", name: "Sam" } });
client.handleWebhook(cmd, await sign(cmd));
const btn = JSON.stringify({ id: "evt5", type: "interaction.button", createdAt: Date.now(), communityId: "c1", channelId: "ch1", messageId: "m7", customId: "yes", user: { id: "u1", username: "sam", name: "Sam" } });
client.handleWebhook(btn, await sign(btn));
await sleep(60);
ok("slash command reaches its handler with quoted args kept together", rolls[0]?.join("|") === "2|big dice");
ok("command reply posts to the channel", seen.some((s) => s.method === "POST" && s.path === "/channels/ch1/messages" && s.body.content === "rolled"));
ok("button reaches its handler", pressed[0] === "sam");
ok("button update edits the pressed message", seen.some((s) => s.method === "PATCH" && s.path === "/channels/ch1/messages/m7" && s.body.content === "Done"));

// A throwing listener is reported, not fatal.
const errors: unknown[] = [];
client.on(Events.Error, (e) => void errors.push(e));
client.command("boom", () => {
  throw new Error("bang");
});
const boom = JSON.stringify({ id: "evt6", type: "interaction.command", createdAt: Date.now(), communityId: "c1", channelId: "ch1", command: "boom", args: "", user: { id: "u1", username: "sam", name: "Sam" } });
client.handleWebhook(boom, await sign(boom));
await sleep(30);
ok("a failing handler goes to the error event", errors.length === 1 && (errors[0] as Error).message === "bang");

// --- other events, registration, shutdown ------------------------------------------------------
const kinds: string[] = [];
for (const e of ["memberAdd", "channelCreate", "voiceStateUpdate", "reactionAdd", "messageDelete"] as const) client.on(e, () => void kinds.push(e));
const evs = [
  { type: "member.joined", communityId: "c1", member: { id: "u2", username: "kim", name: "Kim", isBot: false } },
  { type: "channel.created", communityId: "c1", channel: { id: "ch2", name: "new", type: "text", topic: null } },
  { type: "voice.state", communityId: "c1", channelId: "ch3", action: "joined", user: { id: "u2", username: "kim", name: "Kim", isBot: false } },
  { type: "reaction.added", communityId: "c1", channelId: "ch1", messageId: "m1", emoji: "👍", user: { id: "u2", username: "kim", name: "Kim", isBot: false } },
  { type: "message.deleted", communityId: "c1", channelId: "ch1", messageId: "m1" },
];
for (const [i, e] of evs.entries()) {
  const b = JSON.stringify({ id: "evx" + i, createdAt: Date.now(), ...e });
  client.handleWebhook(b, await sign(b));
}
await sleep(40);
ok("member, channel, voice, reaction and delete events are emitted", kinds.join() === "memberAdd,channelCreate,voiceStateUpdate,reactionAdd,messageDelete", kinds);
ok("a new channel is cached", client.channels.get("ch2")?.name === "new");

seen.length = 0;
await client.registerCommands([{ name: "roll", description: "Roll dice" }]);
ok("registerCommands → PUT /commands", seen[0].method === "PUT" && seen[0].path === "/commands" && seen[0].body.commands[0].name === "roll");

// The heartbeat keeps the bot online, and stops with it.
const beating = make({ keepAlive: true });
beating.on(Events.Error, () => undefined);
await beating.login();
ok("keepAlive on: a heartbeat timer is running", (beating as any).beat !== null);
seen.length = 0;
await beating.destroy();
ok("destroy shows the bot invisible and stops the heartbeat", seen.some((s) => s.path === "/presence" && s.body.status === "invisible") && (beating as any).beat === null);
const quiet = make();
await quiet.login();
ok("keepAlive off: no timer", (quiet as any).beat === null);
await quiet.destroy();
await client.destroy();

// --- the SDK's copy of the permission numbers is the server's --------------------------------------
{
  const { PERMISSIONS } = await import("../../convex/permissions");
  const { BOT_PERMISSIONS } = await import("../../convex/lib/botAuth");
  const { PermissionFlags } = await import("../../sdk/bot/index");
  const snake = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  const wrong = Object.entries(PermissionFlags).filter(([k, bit]) => (PERMISSIONS as Record<string, number>)[snake(k)] !== bit).map(([k]) => k);
  ok("every SDK permission has the server's number", wrong.length === 0, wrong);
  const sdkBits = new Set<number>(Object.values(PermissionFlags));
  ok("the SDK offers exactly the permissions a bot can be granted", BOT_PERMISSIONS.every((x) => sdkBits.has(x.bit)) && sdkBits.size === BOT_PERMISSIONS.length);
}

// --- the events the guide documents are the ones the SDK emits -------------------------------------
{
  const { readFileSync } = await import("node:fs");
  const events = readFileSync(new URL("../../src/studio/docs/content/bots/events.md", import.meta.url), "utf8");
  const missing = Object.keys(Events).filter((name) => !events.includes("`" + name + "`"));
  ok("every Events.* name appears in the events guide", missing.length === 0, missing);
}

// --- the SDK's invite links are what the app reads --------------------------------------------------
{
  const { botInstallUrl, parseInstallRequest } = await import("../../convex/lib/oauthLinks");
  const { inviteUrl, PermissionFlags } = await import("../../sdk/bot/index");
  const id = "k17abcdefgh2345678z";
  const mine = inviteUrl(id, { permissions: ["SendMessages", "ManageRoles"], scopes: ["messages.read", "dm.send"], communityId: id, redirectUri: "https://a.example/cb", state: "s" });
  const theirs = botInstallUrl("https://usecrystal.app", { botId: id, permissions: PermissionFlags.SendMessages | PermissionFlags.ManageRoles, scopes: ["messages.read", "dm.send"], communityId: id, redirectUri: "https://a.example/cb", state: "s" });
  ok("the SDK builds the same link as the app", mine === theirs, { mine, theirs });
  const back = parseInstallRequest(new URL(mine).searchParams);
  ok("and the app reads it back", back.ok && back.request.kind === "bot" && back.request.permissions === (PermissionFlags.SendMessages | PermissionFlags.ManageRoles) && back.request.scopes.join() === "messages.read,dm.send", back);
  ok("it points at usecrystal.app by default, and at a preview when asked", mine.startsWith("https://usecrystal.app/oauth/authorize?") && inviteUrl(id, { origin: "https://preview.example/" }).startsWith("https://preview.example/oauth/authorize?"));
  const c = make();
  try { c.inviteUrl(); ok("inviteUrl before login is refused", false); } catch (e) { ok("inviteUrl before login is refused", e instanceof CrystalError); }
  await c.login();
  ok("after login the client names the bot", c.inviteUrl({ permissions: 2 }).includes("client_id=bot1") && c.inviteUrl().includes("scope=bot"));
  await c.destroy();
}

// --- hearing events without an endpoint: the SDK asks for them ---------------------------------------
{
  const polled = make();
  const got: string[] = [];
  polled.on(Events.MessageCreate, (m) => void got.push(m.content));
  eventAsks.length = 0;
  await polled.login();
  await sleep(400);
  ok("login() starts asking for events by itself (no listen())", eventAsks.length >= 1 && /wait=25/.test(eventAsks[0]) && !/after=/.test(eventAsks[0]), eventAsks);
  const ev = (id: string, text: string) => ({ id, type: "message.created", createdAt: Date.now(), communityId: "c1", channelId: "ch1", message: { id: "m" + id, text, createdAt: Date.now(), replyToId: null, attachments: [], author: { id: "u1", username: "sam", name: "Sam", isBot: false } } });
  eventsFor.push(ev("p1", "one"), ev("p2", "two"));
  await sleep(700);
  ok("events that come back are handled, in order", got.join() === "one,two", got);
  ok("the next ask carries the cursor from the last answer", eventAsks.some((a) => /after=\d+/.test(a)), eventAsks.slice(-3));
  eventsFor.push(ev("p1", "one again"));
  await sleep(500);
  ok("an event id seen twice is handled once", got.join() === "one,two", got);
  const asksBefore = eventAsks.length;
  await polled.destroy();
  await sleep(500);
  const after = eventAsks.length;
  await sleep(500);
  ok("destroy() stops the asking", eventAsks.length === after && after - asksBefore <= 2, { asksBefore, after, now: eventAsks.length });

  // A bot with an endpoint is pushed to; the SDK is told so and stops asking.
  pushMode = true;
  const pushed = make();
  eventAsks.length = 0;
  const debug: string[] = [];
  pushed.on(Events.Debug, (m) => void debug.push(m));
  await pushed.login();
  await sleep(600);
  ok("told the bot has an endpoint, it asks once and stops", eventAsks.length === 1 && debug.some((d) => /endpoint/.test(d)), { asks: eventAsks.length, debug });
  await pushed.destroy();
  pushMode = false;

  // events: "webhook" never asks.
  const hook = make({ events: "webhook" });
  eventAsks.length = 0;
  await hook.login();
  await sleep(400);
  ok('events: "webhook" never asks', eventAsks.length === 0, eventAsks);
  await hook.destroy();
}

api.close();
console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
