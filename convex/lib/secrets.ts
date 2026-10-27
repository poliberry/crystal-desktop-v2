/**
 * Encrypting things we have to be able to read back — a panel's API key, a
 * platform's access token — so that the database never holds them in the clear.
 *
 * AES-256-GCM with a random 96-bit nonce per value, under a key from the
 * deployment's environment (`CREDENTIALS_ENCRYPTION_KEY`, 32 bytes, base64). The
 * stored form is `v1.<nonce>.<ciphertext>`, base64url, so the scheme can change
 * without guessing at old rows. Whoever can read the table but not the
 * environment gets nothing; whoever can read both has more than this protects.
 */

const b64 = {
  enc(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(text: string): Uint8Array {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },
};

async function key(): Promise<CryptoKey> {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("Credential storage isn't set up on this deployment (CREDENTIALS_ENCRYPTION_KEY).");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY has to be 32 bytes, base64 encoded.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await key(), new TextEncoder().encode(plain)));
  return `v1.${b64.enc(nonce)}.${b64.enc(cipher)}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [version, nonce, cipher] = stored.split(".");
  if (version !== "v1" || !nonce || !cipher) throw new Error("That stored credential can't be read.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(nonce) as BufferSource }, await key(), b64.dec(cipher) as BufferSource);
  return new TextDecoder().decode(plain);
}

// --- Signed state ---------------------------------------------------------------------------

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.OAUTH_STATE_SECRET ?? process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!secret) throw new Error("Account connections aren't set up on this deployment.");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A payload nobody can alter, for round-tripping through someone else's redirect —
 * the OAuth `state`. It carries who started the flow and expires in ten minutes. */
export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64.enc(new TextEncoder().encode(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body)));
  return `${body}.${b64.enc(sig)}`;
}

export async function verifyState<T extends Record<string, unknown>>(state: string): Promise<T | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64.dec(sig) as BufferSource, new TextEncoder().encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64.dec(body))) as T & { exp?: number };
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
