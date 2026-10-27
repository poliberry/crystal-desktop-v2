import { BOT_GRANTABLE, BOT_SCOPES } from "./botAuth";

/**
 * Install links: the URL a bot's author (or an extension's publisher) shares so that people can add
 * it without being given an id to paste.
 *
 *   https://usecrystal.app/oauth/authorize?client_id=<bot id>&scope=bot&permissions=<bits>
 *       &scopes=messages.read,dm.send&community_id=<id>&redirect_uri=<https url>&state=<opaque>
 *   https://usecrystal.app/oauth/authorize?client_id=<extension id>&scope=extension
 *
 * Shaped like Discord's, with one difference worth saying plainly: **a link grants nothing.** It is
 * a *request*. The person who opens it sees what is being asked for, chooses which community (a bot)
 * and which of the permissions to give, and can only give what they hold; the server re-checks every
 * rule (`bots.install`). So nothing in a link can be forged into more authority, and a link edited by
 * someone else just asks for something different, which is shown before it is agreed to.
 *
 * Pure: the consent page, Studio's link maker and the tests all use these, and nothing here touches
 * a database or the DOM.
 */

export type InstallRequest =
  | {
      kind: "bot";
      clientId: string;
      /** Asked for; the manager may give less, never more than they hold. */
      permissions: number;
      scopes: string[];
      /** Pre-selects a community. Only a suggestion: the person still has to be allowed to add bots there. */
      communityId: string | null;
      /** Where to send the browser afterwards. Honoured only if the bot's author registered it. */
      redirectUri: string | null;
      state: string | null;
    }
  | { kind: "extension"; clientId: string; redirectUri: string | null; state: string | null };

export const MAX_STATE = 200;
export const MAX_REDIRECT_URIS = 5;
const ID = /^[a-z0-9]{10,40}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * An address a bot's author may register as somewhere to send people after they add the bot: https,
 * or plain http to the machine you are developing on. No credentials, no fragment (a fragment is
 * where a page would put something it doesn't want logged), and short.
 */
export function checkRedirectUri(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("A redirect address has to be a web address.");
  const text = raw.trim();
  if (text.length === 0 || text.length > 500) throw new Error("A redirect address is up to 500 characters.");
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new Error(`“${text.slice(0, 60)}” isn't a web address.`);
  }
  const loopback = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  if (u.protocol !== "https:" && !loopback) throw new Error("A redirect address has to be https (or http://localhost while you are developing).");
  if (u.username || u.password) throw new Error("Leave the username and password out of a redirect address.");
  if (u.hash) throw new Error("A redirect address can't have a # part.");
  return u.href;
}

export function checkRedirectUris(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("Redirect addresses have to be a list.");
  if (input.length > MAX_REDIRECT_URIS) throw new Error(`A bot can have up to ${MAX_REDIRECT_URIS} redirect addresses.`);
  return [...new Set(input.map(checkRedirectUri))];
}

/** Exactly one of the registered addresses (compared as normalised URLs: no prefix matching, which is where open redirects come from). */
export function redirectAllowed(registered: readonly string[], candidate: string | null): string | null {
  if (!candidate) return null;
  let normal: string;
  try {
    normal = checkRedirectUri(candidate);
  } catch {
    return null;
  }
  return registered.includes(normal) ? normal : null;
}

/** The address to send the browser to afterwards: the registered one, plus what happened. */
export function redirectWith(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.href;
}

/**
 * What a link is asking for, or why it isn't a request we understand. Never throws: the page shows
 * the reason. Unknown extra parameters are ignored; known ones are checked, not trusted.
 */
export function parseInstallRequest(search: string | URLSearchParams): { ok: true; request: InstallRequest } | { ok: false; reason: string } {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const clientId = (q.get("client_id") ?? "").trim();
  const scopeWords = (q.get("scope") ?? "bot").split(/[\s+,]+/).filter(Boolean);
  const state = q.get("state");
  if (state && state.length > MAX_STATE) return { ok: false, reason: "This link is malformed (its state is too long)." };
  const redirectRaw = q.get("redirect_uri");
  let redirectUri: string | null = null;
  if (redirectRaw) {
    try {
      redirectUri = checkRedirectUri(redirectRaw);
    } catch {
      // A bad redirect isn't a reason to refuse the install; it is simply not used.
      redirectUri = null;
    }
  }

  const wantsExtension = scopeWords.includes("extension");
  if (wantsExtension && scopeWords.includes("bot")) return { ok: false, reason: "A link can add a bot or an extension, not both." };
  if (!wantsExtension && !scopeWords.includes("bot")) return { ok: false, reason: "This link doesn't say what to add." };

  if (wantsExtension) {
    // An extension's id on a link is its public name (`my-extension`), the one it is published under.
    if (!SLUG.test(clientId) || clientId.length > 40) return { ok: false, reason: "This link doesn't name a valid extension." };
    return { ok: true, request: { kind: "extension", clientId, redirectUri, state } };
  }

  if (!ID.test(clientId)) return { ok: false, reason: "This link doesn't name a valid bot." };
  const permsRaw = q.get("permissions") ?? "0";
  if (!/^\d{1,10}$/.test(permsRaw) || Number(permsRaw) > 0x7fffffff) return { ok: false, reason: "This link's permissions aren't valid." };
  // What a bot can ever hold is a short list; anything else in the number is dropped here, and refused again by the server.
  const permissions = Number(permsRaw) & BOT_GRANTABLE;
  const scopes = [...new Set((q.get("scopes") ?? "").split(/[\s,]+/).filter(Boolean))].filter((s) => (BOT_SCOPES as readonly string[]).includes(s));
  const communityId = (q.get("community_id") ?? "").trim();
  return { ok: true, request: { kind: "bot", clientId, permissions, scopes, communityId: ID.test(communityId) ? communityId : null, redirectUri, state } };
}

/** The shareable link for a bot. `origin` is where our site lives, so a preview deployment makes links to itself. */
export function botInstallUrl(origin: string, opts: { botId: string; permissions?: number; scopes?: readonly string[]; communityId?: string; redirectUri?: string; state?: string }): string {
  const q = new URLSearchParams({ client_id: opts.botId, scope: "bot" });
  const permissions = (opts.permissions ?? 0) & BOT_GRANTABLE;
  if (permissions) q.set("permissions", String(permissions));
  const scopes = (opts.scopes ?? []).filter((s) => (BOT_SCOPES as readonly string[]).includes(s));
  if (scopes.length) q.set("scopes", scopes.join(","));
  if (opts.communityId) q.set("community_id", opts.communityId);
  if (opts.redirectUri) q.set("redirect_uri", opts.redirectUri);
  if (opts.state) q.set("state", opts.state.slice(0, MAX_STATE));
  return `${origin.replace(/\/$/, "")}/oauth/authorize?${q.toString()}`;
}

export function extensionInstallUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/oauth/authorize?${new URLSearchParams({ client_id: slug, scope: "extension" }).toString()}`;
}
