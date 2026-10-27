// Run: npx tsx scripts/tests/bot-auth.test.mts
import { PERMISSIONS as P } from "../../convex/permissions";
import * as B from "../../convex/lib/botAuth";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };
const throws = (n: string, f: () => unknown, re?: RegExp) => { try { f(); ok(n, false, "no throw"); } catch (e) { ok(n, !re || re.test(String((e as Error).message)), (e as Error).message); } };

// ---- what a bot can ever hold
const never = ["ADMINISTRATOR", "MANAGE_COMMUNITY", "MANAGE_INTEGRATIONS", "MANAGE_GAME_SERVERS", "MANAGE_EVENTS"] as const;
for (const k of never) ok(`never grantable: ${k}`, (B.BOT_GRANTABLE & P[k]) === 0);
const expected = ["VIEW_CHANNELS", "SEND_MESSAGES", "CONNECT", "CREATE_INVITE", "MENTION_EVERYONE", "MANAGE_MESSAGES", "MANAGE_NICKNAMES", "MANAGE_EMOJIS", "MUTE_MEMBERS", "DEAFEN_MEMBERS", "MOVE_MEMBERS", "MODERATE_MEMBERS", "KICK_MEMBERS", "BAN_MEMBERS", "MANAGE_CHANNELS", "MANAGE_ROLES"];
ok("grantable set is exactly the documented sixteen", B.BOT_PERMISSIONS.length === expected.length && expected.every((k) => B.BOT_PERMISSIONS.some((p) => p.key === k && p.bit === P[k as keyof typeof P])), B.BOT_PERMISSIONS.map((p) => p.key));
ok("every grantable bit is listed once", new Set(B.BOT_PERMISSIONS.map((p) => p.bit)).size === B.BOT_PERMISSIONS.length);
throws("request: administrator refused", () => B.validateRequest(P.ADMINISTRATOR, []), /can't ask/);
throws("request: manage community refused", () => B.validateRequest(P.SEND_MESSAGES | P.MANAGE_COMMUNITY, []), /can't ask/);
throws("request: manage integrations refused", () => B.validateRequest(P.MANAGE_INTEGRATIONS, []), /can't ask/);
for (const bad of [-1, 1.5, 2 ** 31, NaN]) throws(`request: ${bad} refused`, () => B.validateRequest(bad, []), /valid/);
throws("request: string refused", () => B.validateRequest("2" as never, []), /valid/);
throws("request: unknown scope", () => B.validateRequest(P.SEND_MESSAGES, ["admin.all"]), /data access/);
ok("request: ban + channels + roles accepted", B.validateRequest(P.BAN_MEMBERS | P.MANAGE_CHANNELS | P.MANAGE_ROLES, []).permissions === (P.BAN_MEMBERS | P.MANAGE_CHANNELS | P.MANAGE_ROLES));
ok("request: dedupes scopes", JSON.stringify(B.validateRequest(P.SEND_MESSAGES, ["messages.read", "messages.read", "dm.send"]).scopes) === JSON.stringify(["messages.read", "dm.send"]));

// ---- granting: a person can only give what they hold
const asked = B.BOT_GRANTABLE;
const mod = P.VIEW_CHANNELS | P.SEND_MESSAGES | P.MANAGE_MESSAGES;
const g = (wanted: number, base: number, scopes: string[] = [], req: string[] = ["messages.read", "dm.send"]) => B.computeGrant({ requested: asked, wanted, authoriserBase: base, requestedScopes: req, wantedScopes: scopes });
ok("owner can grant everything asked", g(asked, ~0).permissions === asked);
ok("administrator can grant everything asked", g(asked, P.ADMINISTRATOR).permissions === asked);
ok("moderator grants what they hold", g(P.SEND_MESSAGES | P.MANAGE_MESSAGES, mod).permissions === (P.SEND_MESSAGES | P.MANAGE_MESSAGES));
for (const k of ["BAN_MEMBERS", "MANAGE_CHANNELS", "MANAGE_ROLES", "KICK_MEMBERS", "CONNECT", "MANAGE_EMOJIS"] as const) throws(`moderator cannot grant ${k} they lack`, () => g(P[k], mod), /you have yourself/);
throws("cannot grant more than the bot asked", () => B.computeGrant({ requested: P.SEND_MESSAGES, wanted: P.SEND_MESSAGES | P.BAN_MEMBERS, authoriserBase: ~0, requestedScopes: [], wantedScopes: [] }), /didn't ask/);
throws("administrator never grantable, even by the owner", () => B.computeGrant({ requested: P.ADMINISTRATOR, wanted: P.ADMINISTRATOR, authoriserBase: ~0, requestedScopes: [], wantedScopes: [] }), /can't be given/);
throws("scope not asked for refused", () => g(P.SEND_MESSAGES, ~0, ["members.read"], ["messages.read"]), /didn't ask/);
ok("granting nothing is fine", g(0, mod).permissions === 0);
ok("holds(): administrator and all-ones cover everything", B.holds(P.ADMINISTRATOR, P.BAN_MEMBERS) && B.holds(~0, P.BAN_MEMBERS) && !B.holds(mod, P.BAN_MEMBERS));

// ---- the live clamp
const botRole = asked;
ok("clamp: authoriser holds all → bot keeps all", B.effectivePermissions(botRole, asked | P.MANAGE_COMMUNITY) === botRole);
ok("clamp: authoriser loses a permission → bot loses it", B.effectivePermissions(botRole, mod) === (P.VIEW_CHANNELS | P.SEND_MESSAGES | P.MANAGE_MESSAGES));
ok("clamp: authoriser with nothing → bot nothing", B.effectivePermissions(botRole, 0) === 0);
ok("clamp: owner/admin authoriser doesn't reduce", B.effectivePermissions(botRole, ~0) === botRole && B.effectivePermissions(botRole, P.ADMINISTRATOR) === botRole);
ok("clamp: can never exceed the grantable set even if its role was edited", B.effectivePermissions(botRole | P.ADMINISTRATOR | P.MANAGE_COMMUNITY, ~0) === botRole);
ok("lostFromAuthoriser reports exactly the lost bits", B.lostFromAuthoriser(P.BAN_MEMBERS | P.SEND_MESSAGES, mod) === P.BAN_MEMBERS && B.lostFromAuthoriser(botRole, ~0) === 0 && B.lostFromAuthoriser(botRole, 0) === botRole);

// ---- what a bot may put on a role or an overwrite
const bot = P.VIEW_CHANNELS | P.SEND_MESSAGES | P.MANAGE_ROLES;
ok("grantableToRole: its own bits are fine", B.grantableToRole(bot, P.SEND_MESSAGES).ok);
ok("grantableToRole: a bit it lacks is refused", !B.grantableToRole(bot, P.SEND_MESSAGES | P.BAN_MEMBERS).ok);
ok("grantableToRole: administrator always refused", !B.grantableToRole(~0, P.ADMINISTRATOR).ok && !B.grantableToRole(P.ADMINISTRATOR, P.ADMINISTRATOR).ok);
ok("grantableToRole: keeping what the role already had is fine, adding is not", B.grantableToRole(bot, P.BAN_MEMBERS | P.SEND_MESSAGES, P.BAN_MEMBERS).ok && !B.grantableToRole(bot, P.BAN_MEMBERS | P.KICK_MEMBERS, P.BAN_MEMBERS).ok);
ok("grantableToRole: zero and removals are fine", B.grantableToRole(0, 0).ok && B.grantableToRole(bot, 0, P.BAN_MEMBERS).ok);
ok("grantableToRole: junk refused", !B.grantableToRole(bot, -1).ok && !B.grantableToRole(bot, 1.5).ok && !B.grantableToRole(bot, 2 ** 31).ok);
ok("isBelow", B.isBelow(1, 2) && !B.isBelow(2, 2) && !B.isBelow(3, 2));

// ---- names & commands
throws("name too short", () => B.validateBotName("a")); throws("name with mention chars", () => B.validateBotName("hi @everyone")); throws("name with control char", () => B.validateBotName("bad\u0007name"));
ok("name normalised", B.validateBotName("  Crystal   Helper  ") === "Crystal Helper");
ok("commands lowercased + validated", JSON.stringify(B.validateCommands([{ name: " Roll ", description: "Roll a die" }])) === JSON.stringify([{ name: "roll", description: "Roll a die" }]));
throws("command: bad chars", () => B.validateCommands([{ name: "ro ll", description: "x" }])); throws("command: duplicate", () => B.validateCommands([{ name: "a", description: "x" }, { name: "A", description: "y" }]), /two commands/);
throws("command: empty description", () => B.validateCommands([{ name: "a", description: "" }]), /description/); throws("command: too many", () => B.validateCommands(Array.from({ length: 26 }, (_, i) => ({ name: `c${i}`, description: "d" }))), /up to 25/); throws("command: not a list", () => B.validateCommands("x"));

// ---- tokens + signatures
const t1 = await B.generateToken(), t2 = await B.generateToken();
ok("token format", /^cbt_[a-f0-9]{10}\.[A-Za-z0-9_-]{43}$/.test(t1.token)); ok("tokens unique", t1.token !== t2.token && t1.hash !== t2.hash);
ok("hash is sha256 of the whole token", t1.hash.length === 64 && !t1.token.includes(t1.hash) && t1.hash === (await B.sha256Hex(t1.token)));
const parsed = B.parseAuthorization(`Bot ${t1.token}`); ok("authorization parses", parsed?.prefix === t1.prefix && parsed.token === t1.token);
for (const bad of [null, "", "Bearer " + t1.token, "Bot", `Bot ${t1.token}x`, `Bot ${t1.token.slice(0, -1)}`, "Bot cbt_zz.yy", `bot ${t1.token}`, `Bot  ${t1.token} extra`]) ok(`authorization rejects ${JSON.stringify(bad)?.slice(0, 30)}`, B.parseAuthorization(bad as never) === null);
ok("constantTimeEqual", B.constantTimeEqual("abc", "abc") && !B.constantTimeEqual("abc", "abd") && !B.constantTimeEqual("abc", "ab"));
const secret = B.generateSigningSecret(); const body = JSON.stringify({ type: "message.created" }); const now = 1_800_000_000;
const sig = await B.signEvent(secret, body, now);
ok("signature shape", /^t=\d+,v1=[a-f0-9]{64}$/.test(sig)); ok("valid verifies", await B.verifyEvent(secret, sig, body, 300, now + 10));
ok("tampered body rejected", !(await B.verifyEvent(secret, sig, body + " ", 300, now))); ok("wrong secret rejected", !(await B.verifyEvent(B.generateSigningSecret(), sig, body, 300, now)));
ok("replay after window rejected", !(await B.verifyEvent(secret, sig, body, 300, now + 301))); ok("future timestamp rejected", !(await B.verifyEvent(secret, sig, body, 300, now - 301)));
ok("edited timestamp invalidates", !(await B.verifyEvent(secret, sig.replace(`t=${now}`, `t=${now + 1}`), body, 300, now + 1)));
for (const bad of [null, "", "v1=abc", `t=${now}`, `t=${now},v1=zz`, `t=abc,v1=${"a".repeat(64)}`]) ok(`malformed header rejected ${JSON.stringify(bad)?.slice(0, 20)}`, !(await B.verifyEvent(secret, bad as never, body, 300, now)));

console.log(fails ? `${fails} FAILED (${passes} passed)` : `ALL PASSED (${passes})`); process.exit(fails ? 1 : 0);
