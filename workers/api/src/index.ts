/**
 * api.usecrystal.app: the front door of the Bot API.
 *
 * The API itself runs on Convex (an HTTP action at `/bot/v1/*`), whose address is a long
 * deployment name nobody should have to put in a bot's configuration, or change when the backend
 * moves. This Worker gives it a stable address and does nothing else: it forwards the requests
 * for `/bot/v1/*` and refuses everything else, so the Convex deployment's other routes (webhooks,
 * uploads, OAuth callbacks) are never reachable through this name.
 *
 * What it does and doesn't pass on:
 *  - the bot's `Authorization` header, the body and a few content headers go through; cookies and
 *    everything else a client sent do not;
 *  - redirects are returned, never followed;
 *  - nothing is cached, and no CORS headers are added: a bot is a server, and a web page has no
 *    business holding a bot's token;
 *  - a body over 1 MB is refused here before it is read (the API refuses it too).
 */

export interface Env {
  /** Where the Bot API actually lives, e.g. `https://<deployment>.convex.site`. No trailing slash. */
  CONVEX_SITE_URL: string;
}

const PREFIX = "/bot/v1";
const MAX_BODY = 1024 * 1024;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const FORWARD_REQUEST_HEADERS = ["authorization", "content-type", "accept", "user-agent", "content-length"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "retry-after", "allow", "content-length"];

const json = (status: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { status, message } }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

export function targetFor(url: URL, base: string): string | null {
  const path = url.pathname;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return null;
  // No way to climb out of the prefix: dot segments are resolved by URL parsing before we get here,
  // but an encoded one (`%2e%2e`) would survive as text, and the API has no use for it.
  if (/%2e|%2f|%5c/i.test(path)) return null;
  return `${base.replace(/\/$/, "")}${path}${url.search}`;
}

export async function handle(request: Request, env: Env, upstream: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(JSON.stringify({ name: "Crystal Bot API", version: "v1", base: `${url.origin}${PREFIX}`, docs: "https://usecrystal.app" }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
  }
  const target = targetFor(url, env.CONVEX_SITE_URL ?? "");
  if (!target) return json(404, "There's no such endpoint. The Bot API is under /bot/v1.");
  if (!METHODS.has(request.method)) return json(405, "Use GET, POST, PUT, PATCH or DELETE.", { allow: "GET, POST, PUT, PATCH, DELETE" });
  if (!env.CONVEX_SITE_URL) return json(503, "The API isn't configured.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json(413, "That request is too large.");

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let res: Response;
  try {
    res = await upstream(target, { method: request.method, headers, body: request.method === "GET" ? undefined : request.body, redirect: "manual" });
  } catch {
    return json(502, "Crystal couldn't be reached. Try again in a moment.");
  }
  const out = new Headers({ "cache-control": "no-store" });
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  // A redirect from the API is a mistake, not something to pass to a bot.
  if (res.status >= 300 && res.status < 400) return json(502, "The API answered unexpectedly.");
  return new Response(res.body, { status: res.status, headers: out });
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
