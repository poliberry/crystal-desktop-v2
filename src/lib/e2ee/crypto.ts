/**
 * End-to-end encryption primitives. WebCrypto only, no dependencies, so the same file runs in the
 * Electron renderer, a browser, Node 20+ (the bot SDK) and Convex. The wire formats and the reasons
 * for them are in docs/E2EE.md.
 *
 * This file is copied verbatim to `convex/lib/e2eeCrypto.ts` and `sdk/bot/e2ee-crypto.ts`.
 * `scripts/tests/e2ee.test.mts` fails if the three drift apart.
 */

const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

const CURVE = "P-256";
const WRAP_INFO = "crystal-e2ee-wrap-v1";
const BACKUP_INFO = "crystal-e2ee-backup-v1";
const AAD_PREFIX = "crystal-e2ee-msg-v1";

/** A message body as stored on a row: ciphertext plus which key epoch opens it. */
export type Envelope = { keyId: string; iv: string; ct: string };

export type Identity = {
  /** SPKI, base64url. Safe to publish. */
  publicKey: string;
  /** PKCS8, base64url. Never leaves the device except inside a recovery backup. */
  privateKey: string;
  fingerprint: string;
};

export type Backup = { salt: string; iv: string; ct: string };

/** What goes inside an envelope. `v` lets the format grow. */
export type MessagePayload = {
  v: 1;
  text?: string;
  embeds?: unknown[];
  components?: unknown[];
  /** The words of a poll, which the server must not read (it only counts votes by option number). */
  poll?: { question: string; options: string[] };
};

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

export function toB64u(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const s = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Identity keys
// ---------------------------------------------------------------------------------------------

/** Hex of the first 16 bytes of SHA-256(SPKI), in groups of 4, for people to compare. */
export async function fingerprintOf(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await subtle.digest("SHA-256", fromB64u(publicKey)));
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.replace(/(.{4})(?=.)/g, "$1 ");
}

export async function generateIdentity(): Promise<Identity> {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: CURVE }, true, ["deriveBits"]);
  const publicKey = toB64u(await subtle.exportKey("spki", pair.publicKey));
  const privateKey = toB64u(await subtle.exportKey("pkcs8", pair.privateKey));
  return { publicKey, privateKey, fingerprint: await fingerprintOf(publicKey) };
}

async function importPublic(spki: string): Promise<CryptoKey> {
  return subtle.importKey("spki", fromB64u(spki), { name: "ECDH", namedCurve: CURVE }, true, []);
}

async function importPrivate(pkcs8: string): Promise<CryptoKey> {
  return subtle.importKey("pkcs8", fromB64u(pkcs8), { name: "ECDH", namedCurve: CURVE }, false, ["deriveBits"]);
}

// ---------------------------------------------------------------------------------------------
// Room keys
// ---------------------------------------------------------------------------------------------

export function generateRoomKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

async function hkdfKey(secret: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: string): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seal a room key so only the holder of `recipientPublicKey`'s private half can open it. */
export async function wrapRoomKey(roomKey: Uint8Array<ArrayBuffer>, recipientPublicKey: string): Promise<string> {
  const ephemeral = await subtle.generateKey({ name: "ECDH", namedCurve: CURVE }, true, ["deriveBits"]);
  const ephemeralPublic = toB64u(await subtle.exportKey("spki", ephemeral.publicKey));
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: await importPublic(recipientPublicKey) }, ephemeral.privateKey, 256),
  );
  const salt = concat(fromB64u(ephemeralPublic), fromB64u(recipientPublicKey));
  const key = await hkdfKey(shared, salt, WRAP_INFO);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, roomKey);
  return `w1.${ephemeralPublic}.${toB64u(iv)}.${toB64u(ct)}`;
}

export async function unwrapRoomKey(
  wrapped: string,
  privateKey: string,
  ownPublicKey: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const [tag, ephemeralPublic, iv, ct] = wrapped.split(".");
  if (tag !== "w1" || !ephemeralPublic || !iv || !ct) throw new Error("Unrecognised wrapped key.");
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: await importPublic(ephemeralPublic) }, await importPrivate(privateKey), 256),
  );
  const salt = concat(fromB64u(ephemeralPublic), fromB64u(ownPublicKey));
  const key = await hkdfKey(shared, salt, WRAP_INFO);
  const roomKey = await subtle.decrypt({ name: "AES-GCM", iv: fromB64u(iv) }, key, fromB64u(ct));
  return new Uint8Array(roomKey);
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

export type MessageContext = {
  scope: "conversation" | "channel";
  /** The conversation or channel id. */
  targetId: string;
  keyId: string;
  authorId: string;
};

/** Binds a ciphertext to its room, key and author so the server cannot move it elsewhere. */
export function messageAad(c: MessageContext): Uint8Array<ArrayBuffer> {
  return enc.encode([AAD_PREFIX, c.scope, c.targetId, c.keyId, c.authorId].join("|")) as Uint8Array<ArrayBuffer>;
}

async function aesKey(roomKey: Uint8Array<ArrayBuffer>, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return subtle.importKey("raw", roomKey, "AES-GCM", false, [usage]);
}

export async function encryptMessage(
  roomKey: Uint8Array<ArrayBuffer>,
  payload: Omit<MessagePayload, "v">,
  context: MessageContext,
): Promise<Envelope> {
  const iv = randomBytes(12);
  const body = enc.encode(JSON.stringify({ v: 1, ...payload } satisfies MessagePayload));
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: messageAad(context) },
    await aesKey(roomKey, "encrypt"),
    body,
  );
  return { keyId: context.keyId, iv: toB64u(iv), ct: toB64u(ct) };
}

export async function decryptMessage(
  roomKey: Uint8Array<ArrayBuffer>,
  envelope: Envelope,
  context: MessageContext,
): Promise<MessagePayload> {
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: fromB64u(envelope.iv), additionalData: messageAad(context) },
    await aesKey(roomKey, "decrypt"),
    fromB64u(envelope.ct),
  );
  const parsed = JSON.parse(dec.decode(plain)) as MessagePayload;
  if (parsed?.v !== 1) throw new Error("Unsupported message payload version.");
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// Recovery backup
// ---------------------------------------------------------------------------------------------

/** 32 random bytes the person writes down. Shown once. */
export function generateRecoverySecret(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** `ABCD-EFGH-…`, 52 characters in groups of 4. */
export function formatRecoverySecret(secret: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of secret) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out.replace(/(.{4})(?=.)/g, "$1-");
}

export function parseRecoverySecret(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (out.length !== 32) throw new Error("That recovery key isn't the right length.");
  const bytes = new Uint8Array(new ArrayBuffer(32));
  bytes.set(out);
  return bytes;
}

export async function makeBackup(privateKey: string, recoverySecret: Uint8Array<ArrayBuffer>): Promise<Backup> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await hkdfKey(recoverySecret, salt, BACKUP_INFO);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, fromB64u(privateKey));
  return { salt: toB64u(salt), iv: toB64u(iv), ct: toB64u(ct) };
}

/** Throws if the recovery secret is wrong. */
export async function openBackup(backup: Backup, recoverySecret: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await hkdfKey(recoverySecret, fromB64u(backup.salt), BACKUP_INFO);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: fromB64u(backup.iv) }, key, fromB64u(backup.ct));
  return toB64u(plain);
}
