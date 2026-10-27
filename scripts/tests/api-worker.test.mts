import { handle, targetFor } from "../../workers/api/src/index";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const env = { CONVEX_SITE_URL: "https://dep.convex.site/" };
const calls: { url: string; init: RequestInit }[] = [];
const up = (status = 200, body = '{"ok":true}', headers: Record<string, string> = { "content-type": "application/json", "set-cookie": "x=1", "x-secret": "no" }) =>
  (async (url: unknown, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return new Response(body, { status, headers }); }) as unknown as typeof fetch;
const req = (path: string, init: RequestInit = {}) => new Request(`https://api.usecrystal.app${path}`, init);

// What is forwarded.
{
  calls.length = 0;
  const r = await handle(req("/bot/v1/channels/c1/messages?limit=5", { method: "POST", headers: { authorization: "Bot tok", "content-type": "application/json", cookie: "session=abc", "x-forwarded-for": "1.2.3.4", origin: "https://evil.test" }, body: '{"content":"hi"}' }), env, up());
  const h = new Headers(calls[0].init.headers);
  ok("goes to the Convex site, same path and query", calls[0].url === "https://dep.convex.site/bot/v1/channels/c1/messages?limit=5", calls[0].url);
  ok("the token and content type go through", h.get("authorization") === "Bot tok" && h.get("content-type") === "application/json");
  ok("cookies and other headers do not", !h.has("cookie") && !h.has("x-forwarded-for") && !h.has("origin"), [...h.keys()]);
  ok("the method and redirect mode are right", calls[0].init.method === "POST" && calls[0].init.redirect === "manual");
  ok("the answer comes back with its status and body", r.status === 200 && (await r.text()) === '{"ok":true}');
  ok("response cookies and unknown headers are dropped; nothing is cached", !r.headers.has("set-cookie") && !r.headers.has("x-secret") && r.headers.get("cache-control") === "no-store");
  ok("no CORS headers are added", !r.headers.has("access-control-allow-origin"));
}
// What is refused.
for (const path of ["/", "/stripe/webhook", "/livekit/webhook", "/r2/upload", "/oauth/callback/twitch", "/bot/v2/me", "/bot", "/botx/v1/me", "/bot/v1x", "/other/bot/v1/me", "/bot/v1/%2e%2e/stripe/webhook", "/bot/v1/a%2fb", "/bot/v1/a%5cb"]) {
  calls.length = 0;
  const r = await handle(req(path, { method: path === "/" ? "POST" : "GET" }), env, up());
  ok(`${path} is not forwarded`, calls.length === 0 && r.status === 404, { status: r.status, calls: calls.length });
}
ok("the front page says what this is", (await handle(req("/"), env, up())).status === 200);
ok("dot segments are resolved away by URL parsing, never reaching the upstream", targetFor(new URL("https://x/bot/v1/../../stripe/webhook"), "https://d") === null);
// Methods and sizes.
for (const m of ["OPTIONS", "TRACE", "HEAD", "CONNECT"]) { calls.length = 0; const r = await handle(req("/bot/v1/me", { method: m }), env, up()); ok(`${m} is refused`, r.status === 405 && calls.length === 0, r.status); }
for (const m of ["GET", "PUT", "PATCH", "DELETE"]) { calls.length = 0; await handle(req("/bot/v1/me", { method: m }), env, up()); ok(`${m} is forwarded`, calls.length === 1); }
ok("a GET carries no body", (calls.length = 0, await handle(req("/bot/v1/me"), env, up()), calls[0].init.body === undefined));
{ calls.length = 0; const r = await handle(req("/bot/v1/channels/c/messages", { method: "POST", headers: { "content-length": String(2 * 1024 * 1024) }, body: "x" }), env, up()); ok("an oversized body is refused before it is read", r.status === 413 && calls.length === 0, r.status); }
// Errors from upstream.
{ const r = await handle(req("/bot/v1/me"), env, up(429, '{"error":{"status":429,"message":"Slow down."}}', { "content-type": "application/json", "retry-after": "30" })); ok("429 and Retry-After reach the bot", r.status === 429 && r.headers.get("retry-after") === "30"); }
{ const r = await handle(req("/bot/v1/me"), env, up(302, "", { location: "https://evil.test/" })); ok("a redirect from upstream is never passed on", r.status === 502 && !r.headers.has("location")); }
{ const r = await handle(req("/bot/v1/me"), env, (async () => { throw new Error("boom"); }) as unknown as typeof fetch); ok("an unreachable upstream is a clear 502", r.status === 502 && /couldn't be reached/.test(((await r.json()) as any).error.message)); }
{ const r = await handle(req("/bot/v1/me"), { CONVEX_SITE_URL: "" }, up()); ok("an unconfigured worker says so", r.status === 503); }
{ const r = await handle(req("/bot/v1/me"), env, up()); ok("errors have the API's own shape", ((await handle(req("/nope"), env, up())).headers.get("content-type") ?? "").includes("json")); void r; }

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
