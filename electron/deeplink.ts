/**
 * Which links belong to the app, and what each one means.
 *
 * One parser, used by the main process (to decide what a link the OS or a click hands it is), by the
 * renderer and by the landing pages (to turn the address they are on into the link that opens the
 * app). Pure and dependency-free so all three can import it; it lives in `electron/` because that
 * project can't import from `src/` but `src/` can import from here.
 *
 * Two spellings of every link, with the same meaning:
 *
 *   https://usecrystal.app/invite/<code>              what people share
 *   crystal://invite/<code>                           what a web page hands the installed app
 *
 *   https://usecrystal.app/oauth/authorize?client_id=…   add a bot (to a community) or an
 *   crystal://oauth/authorize?client_id=…                extension (to your account)
 *
 *   https://usecrystal.app/app/#/dm/<id>              a place in the app: a DM, a channel, Friends,
 *   crystal://dm/<id>                                 or a call to join (what notifications open).
 *   crystal://channel/<communityId>/<channelId>       The web app reads the same routes from its hash;
 *   crystal://call/dm/<id>                            see `appRouteFor` and src/components/home/
 *   crystal://call/channel/<communityId>/<channelId>  tabs-context.tsx.
 *   crystal://friends
 *
 * `crystal://auth/callback?…` finishes a sign-in and is *only* accepted in its `crystal://` form: a
 * web page must never be able to make the app treat an https link as a sign-in.
 *
 * Only our own hosts count. A link to anyone else's site is not an app link, so the app opens it in
 * the browser as it always did.
 */

export const APP_ORIGIN = "https://usecrystal.app";
export const APP_PROTOCOL = "crystal";

/** The Bot API's front door (a Worker in workers/api that forwards /bot/v1/* to the backend). */
export const API_ORIGIN = "https://api.usecrystal.app";
export const BOT_API_URL = `${API_ORIGIN}/bot/v1`;

/** Hosts whose links open in the app. `crystal.poliberry.com` is where invites used to point; links
 * already posted there keep working. */
export const APP_HOSTS: readonly string[] = ["usecrystal.app", "www.usecrystal.app", "crystal.poliberry.com"];

export type DeepLink =
  | { kind: "auth"; url: string }
  /** Bring Crystal forward (what Crystal Studio's "Open Crystal" sends). Only in the `crystal://` form. */
  | { kind: "open" }
  | { kind: "invite"; code: string }
  /** Add a bot or an extension. `search` is the query string, validated later by the page that uses it. */
  | { kind: "authorize"; search: string }
  /** A place in the app, as the web app's hash route (`#/dm/<id>`, `#/call/channel/<c>/<ch>`…). */
  | { kind: "route"; hash: string };

const INVITE = /^\/invite\/([a-zA-Z0-9]{4,32})\/?$/;
const AUTHORIZE = /^\/oauth\/authorize\/?$/;
/** A query longer than this isn't a real request; refuse it before anything parses it. */
const MAX_SEARCH = 2000;

export function parseDeepLink(raw: string): DeepLink | null {
  if (typeof raw !== "string" || raw.length > 4000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  let path: string;
  let viaScheme = false;
  if (url.protocol === `${APP_PROTOCOL}:`) {
    // crystal://invite/abc → host "invite", path "/abc"
    path = `/${url.hostname.toLowerCase()}${url.pathname}`;
    viaScheme = true;
  } else if (url.protocol === "https:" && APP_HOSTS.includes(url.hostname.toLowerCase()) && !url.username && !url.password && (url.port === "" || url.port === "443")) {
    path = url.pathname;
  } else {
    return null;
  }

  if (viaScheme && /^\/auth\/callback\/?$/.test(path)) return { kind: "auth", url: raw.trim() };
  if (viaScheme && /^\/open\/?$/.test(path)) return { kind: "open" };
  const invite = INVITE.exec(path);
  if (invite) return { kind: "invite", code: invite[1] };
  if (AUTHORIZE.test(path) && url.search.length <= MAX_SEARCH) return { kind: "authorize", search: url.search };
  // https://usecrystal.app/app/#/dm/<id>: the route is the hash.
  if (!viaScheme && /^\/app\/?$/.test(path)) {
    const route = routeFromPath(url.hash.replace(/^#/, ""));
    if (route) return { kind: "route", hash: route };
  }
  // crystal://dm/<id> and friends: the route is the path.
  if (viaScheme) {
    const route = routeFromPath(path);
    if (route) return { kind: "route", hash: route };
  }
  return null;
}

const ID = "[a-z0-9]{10,40}";
const ROUTES: [RegExp, (m: RegExpExecArray) => string][] = [
  [new RegExp(`^/dm/(${ID})/?$`), (m) => `#/dm/${m[1]}`],
  [new RegExp(`^/(?:channel|community)/(${ID})/(${ID})/?$`), (m) => `#/community/${m[1]}/${m[2]}`],
  [new RegExp(`^/call/dm/(${ID})/?$`), (m) => `#/call/dm/${m[1]}`],
  [new RegExp(`^/call/channel/(${ID})/(${ID})/?$`), (m) => `#/call/channel/${m[1]}/${m[2]}`],
  [/^\/friends\/?$/, () => "#/friends"],
];

/** A path like `/dm/<id>` as the app's hash route, or null if it isn't a place the app has. Ids are
 * checked for shape here, so nothing but these exact routes can reach the renderer. */
export function routeFromPath(path: string): string | null {
  const clean = path.split("?")[0].toLowerCase();
  for (const [re, toHash] of ROUTES) {
    const m = re.exec(clean);
    if (m) return toHash(m);
  }
  return null;
}

/** The scheme Crystal Studio, the separate application, is the handler for. */
export const STUDIO_PROTOCOL = "crystal-studio";

export type StudioLink =
  /** Bring Studio to the front (what Crystal's "Open Studio" sends). */
  | { kind: "open" }
  /** Finish a sign-in, as `crystal://auth/callback` does for Crystal. */
  | { kind: "auth"; url: string };

/** What a `crystal-studio://` link means, or null if it isn't one. Studio takes no other kind of link. */
export function parseStudioLink(raw: string): StudioLink | null {
  if (typeof raw !== "string" || raw.length > 4000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${STUDIO_PROTOCOL}:`) return null;
  const path = `/${url.hostname.toLowerCase()}${url.pathname}`.replace(/\/+$/, "");
  if (path === "/auth/callback") return { kind: "auth", url: raw.trim() };
  if (path === "/open" || path === "") return { kind: "open" };
  return null;
}

/** Whether an https link is one the app should handle itself instead of handing to the browser. */
export const isAppLink = (raw: string): boolean => {
  try {
    return new URL(raw).protocol === "https:" && parseDeepLink(raw) !== null;
  } catch {
    return false;
  }
};

/**
 * The `crystal://` link that opens the app on whatever web page this is, or null if the page isn't
 * one the app has a view for. Used by the landing pages to hand over to an installed app.
 */
export function appLinkFor(pathname: string, search: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  const invite = /^\/invite\/([a-zA-Z0-9]{4,32})$/.exec(path);
  if (invite) return `${APP_PROTOCOL}://invite/${invite[1]}`;
  // The invite page also works as `/invite/?code=abc123` on a host with no rewrite for /invite/*.
  if (path === "/invite" && search.length <= MAX_SEARCH) {
    const code = new URLSearchParams(search).get("code") ?? "";
    if (/^[a-zA-Z0-9]{4,32}$/.test(code)) return `${APP_PROTOCOL}://invite/${code}`;
  }
  if (path === "/oauth/authorize" && search.length <= MAX_SEARCH) return `${APP_PROTOCOL}://oauth/authorize${search}`;
  return null;
}

/** The link that gets shared for a path on our own site. */
export const webLink = (path: string, origin: string = APP_ORIGIN): string => `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
