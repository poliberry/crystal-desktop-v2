/**
 * Where passkeys may be used.
 *
 * A passkey is bound to the site it was made on (its "relying party ID", the site's host name).
 * Crystal runs on more than one origin — the website, and the desktop app, which serves itself from
 * `http://crystal.localhost` — and a passkey made on one doesn't work on another. So the server
 * keeps a list of the origins it will accept, and a passkey is checked against whichever of them
 * the browser says it was used on (which the browser, not the page, writes into what it signs).
 *
 * Set `WEBAUTHN_ORIGINS` on the deployment to a comma-separated list, e.g.
 * `https://usecrystal.app,http://crystal.localhost,http://localhost:3000`.
 */

export const RP_NAME = "Crystal";

const DEFAULT_ORIGINS = ["https://usecrystal.app", "http://crystal.localhost", "http://localhost:3000"];

function parseOrigin(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname.endsWith(".localhost")))) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedOrigins(): string[] {
  const configured = (process.env.WEBAUTHN_ORIGINS ?? "")
    .split(",")
    .map(parseOrigin)
    .filter((o): o is string => o !== null);
  const fallback = [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, ...DEFAULT_ORIGINS]
    .map((o) => (o ? parseOrigin(o) : null))
    .filter((o): o is string => o !== null);
  return [...new Set(configured.length ? configured : fallback)];
}

/** The relying party ID for an origin, if that origin is one we accept. */
export function rpIdFor(origin: string): string | null {
  const parsed = parseOrigin(origin);
  if (!parsed || !allowedOrigins().includes(parsed)) return null;
  return new URL(parsed).hostname;
}

/** Decode base64url to bytes. */
export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What the browser signed: the origin it was on and the challenge it was given. */
export function readClientData(clientDataJSON: string): { origin: string; challenge: string; type: string } | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(clientDataJSON)));
    if (typeof data?.origin !== "string" || typeof data?.challenge !== "string" || typeof data?.type !== "string") return null;
    return { origin: data.origin, challenge: data.challenge, type: data.type };
  } catch {
    return null;
  }
}
