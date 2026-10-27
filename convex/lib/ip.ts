/**
 * IP addresses, handled as carefully as anything we keep about a person.
 *
 * An address is never stored as it arrived. Two things are kept instead:
 *
 *  - `ipCipher`: the address encrypted (AES-256-GCM, `lib/secrets`). It is random
 *    each time, so it can't be searched — it exists so the address can be
 *    re-keyed or produced for a legal request, and nothing in the console or the
 *    app decrypts it.
 *  - `ipHash`: an HMAC-SHA-256 of the *normalised* address under `IP_HASH_KEY`, a
 *    separate secret. It is the same for the same address, so it is what a ban is
 *    looked up by, and it can't be reversed or rainbow-tabled without the key
 *    (the IPv4 space is small enough that a plain hash would be no protection).
 *
 * Nothing in this file is imported by a query that returns data to a client.
 */

import { encryptSecret } from "./secrets";

/** Lower-case, strip a zone id and brackets, unwrap an IPv4-mapped IPv6 address,
 * and reduce an IPv6 address to its /64 — the unit one household or machine
 * controls, and which privacy extensions rotate within. Returns `null` for
 * something that isn't an address. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (!ip) return null;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    return parts.join(".");
  }

  if (ip.includes(":")) return normalizeIpv6(ip);
  return null;
}

function normalizeIpv6(ip: string): string | null {
  if (!/^[0-9a-f:]+$/.test(ip) || ip.split("::").length > 2) return null;
  const [head, tail] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail !== undefined && tail ? tail.split(":") : [];
  const hasGap = ip.includes("::");
  if (headGroups.concat(tailGroups).some((g) => g.length === 0 || g.length > 4)) return null;
  const missing = 8 - headGroups.length - tailGroups.length;
  if (hasGap ? missing < 1 : missing !== 0) return null;
  const groups = [...headGroups, ...Array<string>(hasGap ? missing : 0).fill("0"), ...tailGroups];
  if (groups.length !== 8) return null;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Whether an address can be tied to a household: private, loopback and link-local
 * ranges can't, and banning one would ban everybody behind it. */
export function isPublicIp(normalized: string): boolean {
  if (normalized.includes(":")) {
    return !(normalized.startsWith("0:0:0:0:") || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized));
  }
  const [a, b] = normalized.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether lookups by address can work on this deployment. */
export function ipProtectionConfigured(): boolean {
  return !!process.env.IP_HASH_KEY && !!process.env.CREDENTIALS_ENCRYPTION_KEY;
}

/** The searchable, one-way form of an address. */
export async function hashIp(normalized: string): Promise<string> {
  const secret = process.env.IP_HASH_KEY;
  if (!secret) throw new Error("IP lookups aren't set up on this deployment (IP_HASH_KEY).");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`ip:v1:${normalized}`))));
}

/** The pair stored for an address, or `null` when it can't be used: not an
 * address, not public, or the deployment isn't configured for it. */
export async function sealIp(raw: string | null | undefined): Promise<{ ipHash: string; ipCipher: string } | null> {
  const normalized = normalizeIp(raw);
  if (!normalized || !isPublicIp(normalized) || !ipProtectionConfigured()) return null;
  return { ipHash: await hashIp(normalized), ipCipher: await encryptSecret(normalized) };
}
