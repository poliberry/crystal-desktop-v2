/**
 * VENDORED from poliberry/axiom packages/axiom-bridge/src/protocol.ts — do not edit here.
 * Update it from the Axiom repo with `npm run bridge:install -- crystal <this convex dir>`.
 */
/**
 * Axiom Bridge wire protocol, v2. Shared by Axiom (client) and every bridge (server).
 *
 * Both sides hold one shared secret per system. From it, HKDF-SHA256 derives two independent keys:
 *   - an AES-256-GCM key that encrypts every request and response body, and
 *   - an HMAC-SHA256 key that signs every request.
 * This sits on top of TLS, so bodies stay opaque to anything that terminates or logs HTTPS
 * (proxies, platform request logs).
 *
 * Request
 *   POST /axiom/v1/<op>
 *   x-axiom-version:   2
 *   x-axiom-timestamp: unix ms (±60 s)
 *   x-axiom-nonce:     128-bit random hex, single use
 *   x-axiom-operator:  PoliberryConnect subject of the operator
 *   x-axiom-change:    change request ref (writes only; empty otherwise)
 *   x-axiom-signature: hex HMAC(macKey, context + "\n" + body)
 *   body: {"iv": b64, "ct": b64}   AES-GCM(encKey, plaintext JSON, aad = context)
 *   context = "axiom-bridge/2\n" + ts + "\n" + nonce + "\n" + op + "\n" + operator + "\n" + change
 *
 * Response
 *   body: {"iv": b64, "ct": b64}   AES-GCM(encKey, JSON, aad = "axiom-bridge/2/response\n" + nonce + "\n" + status)
 *   The response is bound to the request's nonce and to the HTTP status, so it can't be replayed
 *   against another request or have its status swapped.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PROTOCOL_VERSION = "2";
export const MAX_SKEW_MS = 60_000;

export interface BridgeKeys {
  encKey: CryptoKey;
  macKey: CryptoKey;
}

export interface Envelope {
  iv: string;
  ct: string;
}

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

export function unb64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const hex = (buf: ArrayBuffer | Uint8Array) => [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function randomHex(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b);
}

/** Derives the AES and HMAC keys from a shared secret (≥ 32 characters). */
export async function deriveKeys(secret: string): Promise<BridgeKeys> {
  if (!secret || secret.length < 32) throw new Error("Bridge secret must be at least 32 characters.");
  const ikm = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const salt = enc.encode("poliberry/axiom-bridge/v2");
  const encKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("encryption") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const macKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("signature") },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
  return { encKey, macKey };
}

export function requestContext(ts: string, nonce: string, op: string, operator: string, change: string): string {
  return `axiom-bridge/${PROTOCOL_VERSION}\n${ts}\n${nonce}\n${op}\n${operator}\n${change}`;
}

export const responseContext = (nonce: string, status: number) => `axiom-bridge/${PROTOCOL_VERSION}/response\n${nonce}\n${status}`;

export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<Envelope> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value ?? null)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJson<T>(key: CryptoKey, envelope: Envelope, aad: string): Promise<T> {
  if (!envelope || typeof envelope.iv !== "string" || typeof envelope.ct !== "string") throw new Error("Malformed envelope.");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) as BufferSource, additionalData: enc.encode(aad) }, key, unb64(envelope.ct) as BufferSource);
  return JSON.parse(dec.decode(pt)) as T;
}

export async function sign(key: CryptoKey, context: string, body: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${context}\n${body}`)));
}

/** Constant-time verification (WebCrypto's HMAC verify). */
export async function verify(key: CryptoKey, context: string, body: string, signatureHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(signatureHex)) return false;
  const sig = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sig[i] = parseInt(signatureHex.slice(i * 2, i * 2 + 2), 16);
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(`${context}\n${body}`));
}
