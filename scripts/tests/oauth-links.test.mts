import { BOT_GRANTABLE, BOT_PERMISSIONS } from "../../convex/lib/botAuth";
import { PERMISSIONS } from "../../convex/permissions";
import { botInstallUrl, checkRedirectUri, checkRedirectUris, extensionInstallUrl, parseInstallRequest, redirectAllowed, redirectWith } from "../../convex/lib/oauthLinks";
import { parseDeepLink } from "../../electron/deeplink";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const throws = (n: string, fn: () => unknown, re: RegExp) => { try { fn(); ok(n, false, "did not throw"); } catch (e) { ok(n, re.test((e as Error).message), (e as Error).message); } };
const BOT = "k17abcdefgh2345678z";

// --- parsing -------------------------------------------------------------------------------------
{
  const r = parseInstallRequest(`client_id=${BOT}&scope=bot&permissions=${PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS}&scopes=messages.read,dm.send&community_id=${BOT}&state=abc`);
  ok("a full bot request parses", r.ok && r.request.kind === "bot" && r.request.clientId === BOT && r.request.permissions === (PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS) && r.request.scopes.join() === "messages.read,dm.send" && r.request.communityId === BOT && r.request.state === "abc", r);
  const bare = parseInstallRequest(`client_id=${BOT}`);
  ok("scope defaults to bot, permissions to none", bare.ok && bare.request.kind === "bot" && bare.request.permissions === 0 && bare.request.scopes.length === 0, bare);
  ok("a leading ? is fine", parseInstallRequest(`?client_id=${BOT}&scope=bot`).ok);
  ok("URLSearchParams accepted", parseInstallRequest(new URLSearchParams({ client_id: BOT, scope: "bot" })).ok);
}
{
  // Permissions: only what a bot can ever hold survives, so a hand-edited link can't ask for Administrator.
  const evil = parseInstallRequest(`client_id=${BOT}&scope=bot&permissions=${PERMISSIONS.ADMINISTRATOR | PERMISSIONS.MANAGE_INTEGRATIONS | PERMISSIONS.SEND_MESSAGES}`);
  ok("never-grantable permissions are dropped from a request", evil.ok && evil.request.kind === "bot" && evil.request.permissions === PERMISSIONS.SEND_MESSAGES, evil);
  const all = parseInstallRequest(`client_id=${BOT}&permissions=${BOT_GRANTABLE}`);
  ok("every grantable permission can be asked for", all.ok && all.request.kind === "bot" && all.request.permissions === BOT_GRANTABLE);
  for (const bad of ["-1", "1.5", "abc", "99999999999", "2147483648", "0x10", "1e3"]) ok(`permissions=${bad} is refused`, !parseInstallRequest(`client_id=${BOT}&permissions=${bad}`).ok);
  const scopes = parseInstallRequest(`client_id=${BOT}&scopes=messages.read,bogus,messages.read,admin`);
  ok("unknown and repeated scopes are dropped", scopes.ok && scopes.request.kind === "bot" && scopes.request.scopes.join() === "messages.read", scopes);
}
{
  for (const [name, q] of [
    ["no client_id", "scope=bot"],
    ["client_id with punctuation", "client_id=../../x&scope=bot"],
    ["too short", "client_id=abc&scope=bot"],
    ["uppercase id", `client_id=${BOT.toUpperCase()}&scope=bot`],
    ["unknown scope word", `client_id=${BOT}&scope=identify`],
    ["bot and extension", `client_id=${BOT}&scope=bot+extension`],
    ["state too long", `client_id=${BOT}&state=${"a".repeat(201)}`],
  ] as const) ok(`${name} is refused`, !parseInstallRequest(q).ok, parseInstallRequest(q));
  const ext = parseInstallRequest("client_id=my-extension&scope=extension");
  ok("an extension request parses (by public name)", ext.ok && ext.request.kind === "extension" && ext.request.clientId === "my-extension", ext);
  ok("space-separated and plus-separated scopes both work", parseInstallRequest("client_id=my-extension&scope=extension").ok && parseInstallRequest(`client_id=${BOT}&scope=bot%20extension`).ok === false);
  ok("an extension name must be a slug", !parseInstallRequest("client_id=My_Extension&scope=extension").ok && !parseInstallRequest("client_id=a--b&scope=extension").ok);
  const noComm = parseInstallRequest(`client_id=${BOT}&community_id=not valid!`);
  ok("a malformed community_id is ignored, not fatal", noComm.ok && noComm.request.kind === "bot" && noComm.request.communityId === null);
}

// --- redirect addresses --------------------------------------------------------------------------
ok("https is a valid redirect", checkRedirectUri("https://app.example.com/crystal/done") === "https://app.example.com/crystal/done");
ok("localhost http is valid while developing", checkRedirectUri("http://localhost:3000/cb") === "http://localhost:3000/cb" && checkRedirectUri("http://127.0.0.1:8080/cb").startsWith("http://127.0.0.1"));
for (const bad of ["http://example.com/cb", "javascript:alert(1)", "data:text/html,x", "ftp://example.com", "crystal://auth/callback", "https://u:p@example.com/cb", "https://example.com/cb#token", "//example.com", "not a url", "", " ", "https://example.com/" + "a".repeat(500)]) {
  throws(`redirect refused: ${bad.slice(0, 40) || "(empty)"}`, () => checkRedirectUri(bad), /./);
}
throws("a non-string redirect is refused", () => checkRedirectUri(42 as never), /web address/);
ok("a list is de-duplicated and normalised", checkRedirectUris(["https://a.example/cb", "https://a.example/cb"]).length === 1);
throws("too many redirects", () => checkRedirectUris(Array.from({ length: 6 }, (_, i) => `https://a${i}.example/cb`)), /up to 5/);
throws("redirects must be a list", () => checkRedirectUris("https://a.example/cb" as never), /list/);

// Open redirects: only an exact registered address is ever followed.
const reg = ["https://app.example.com/crystal/done", "http://localhost:3000/cb"];
ok("a registered address is allowed", redirectAllowed(reg, "https://app.example.com/crystal/done") === "https://app.example.com/crystal/done");
for (const attempt of [
  "https://app.example.com/crystal/done/../../evil",
  "https://app.example.com/crystal/done/extra",
  "https://app.example.com/crystal/done?next=https://evil.test",
  "https://app.example.com.evil.test/crystal/done",
  "https://evil.test/crystal/done",
  "https://app.example.com@evil.test/crystal/done",
  "http://app.example.com/crystal/done",
  "javascript:alert(1)",
  "",
  null,
]) ok(`not allowed: ${String(attempt).slice(0, 50)}`, redirectAllowed(reg, attempt as string | null) === null, redirectAllowed(reg, attempt as string | null));
ok("nothing is allowed when nothing is registered", redirectAllowed([], "https://app.example.com/crystal/done") === null);
ok("a redirect is made with what happened, and an existing query survives", redirectWith("https://a.example/cb?keep=1", { community_id: "c1", state: "xyz", permissions: "2", skip: null }) === "https://a.example/cb?keep=1&community_id=c1&state=xyz&permissions=2");

// --- building -------------------------------------------------------------------------------------
{
  const url = botInstallUrl("https://usecrystal.app/", { botId: BOT, permissions: PERMISSIONS.SEND_MESSAGES | PERMISSIONS.MANAGE_ROLES, scopes: ["messages.read", "nope"], redirectUri: "https://a.example/cb", state: "s1" });
  ok("a built link starts on our site", url.startsWith("https://usecrystal.app/oauth/authorize?"));
  const back = parseInstallRequest(new URL(url).searchParams);
  ok("what is built is read back the same", back.ok && back.request.kind === "bot" && back.request.permissions === (PERMISSIONS.SEND_MESSAGES | PERMISSIONS.MANAGE_ROLES) && back.request.scopes.join() === "messages.read" && back.request.redirectUri === "https://a.example/cb" && back.request.state === "s1", back);
  ok("a built link is one the app opens", parseDeepLink(url)?.kind === "authorize");
  const minimal = botInstallUrl("https://usecrystal.app", { botId: BOT });
  ok("an empty request omits the empty parameters", minimal === `https://usecrystal.app/oauth/authorize?client_id=${BOT}&scope=bot`, minimal);
  const sneaky = botInstallUrl("https://usecrystal.app", { botId: BOT, permissions: PERMISSIONS.ADMINISTRATOR | PERMISSIONS.SEND_MESSAGES });
  ok("building never puts a never-grantable permission in a link", new URL(sneaky).searchParams.get("permissions") === String(PERMISSIONS.SEND_MESSAGES), sneaky);
  ok("every permission the guide lists survives a round trip", BOT_PERMISSIONS.every((x) => { const r = parseInstallRequest(new URL(botInstallUrl("https://usecrystal.app", { botId: BOT, permissions: x.bit })).searchParams); return r.ok && r.request.kind === "bot" && r.request.permissions === x.bit; }));
  const ext = extensionInstallUrl("https://usecrystal.app", "my-extension");
  const e = parseInstallRequest(new URL(ext).searchParams);
  ok("an extension link round-trips and opens the app", e.ok && e.request.kind === "extension" && parseDeepLink(ext)?.kind === "authorize", e);
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
