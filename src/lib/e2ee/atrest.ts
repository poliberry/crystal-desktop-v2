/**
 * Device-local encryption for things cached in plaintext on purpose, such as the decrypted search
 * index. The key is derived from the identity private key, so it exists only while this device holds the
 * identity, and a new identity (reset) makes the old cache unreadable, which is what we want.
 *
 * Output layout: 12-byte IV followed by AES-256-GCM ciphertext.
 */
import { fromB64u } from "./crypto";

const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
const INFO = new TextEncoder().encode("crystal-e2ee-atrest-v1");
const SALT = new TextEncoder().encode("crystal-e2ee-atrest-salt");

let cached: { privateKey: string; key: Promise<CryptoKey> } | null = null;

function keyFor(privateKey: string): Promise<CryptoKey> {
  if (cached?.privateKey === privateKey) return cached.key;
  const key = (async () => {
    const base = await subtle.importKey("raw", fromB64u(privateKey), "HKDF", false, ["deriveKey"]);
    return subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  cached = { privateKey, key };
  return key;
}

export async function sealAtRest(privateKey: string, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = new Uint8Array(new ArrayBuffer(12));
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(iv);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(privateKey), bytes as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

/** `null` when the bytes were not sealed by this identity, or were altered. */
export async function openAtRest(privateKey: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.length < 12 + 16) return null;
  try {
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await keyFor(privateKey),
      bytes.slice(12),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
