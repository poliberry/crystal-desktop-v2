/**
 * Two-step verification primitives: TOTP (RFC 6238) and single-use backup codes.
 *
 * Pure and dependency-free (WebCrypto only), so they run in the Convex runtime and under
 * `bun` in scripts/tests/two-factor.test.mts. Nothing here touches the database; the
 * tables and the rules about when a code is required live in convex/twoFactor.ts.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** How long one TOTP code is valid for. 30s is what every authenticator app assumes. */
export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
/** Codes either side of "now" that are still accepted, for clocks that are a little off. */
export const TOTP_WINDOW = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Not a valid base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new 160-bit secret, base32, the length authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The `otpauth://` address a QR code carries; authenticator apps read the secret from it. */
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${params}`;
}

/** The time step (counter) that `nowMs` falls in. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
}

/** The code for one step. HOTP (RFC 4226) with the step as the counter. */
export async function totpCode(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter as BufferSource));
  const offset = mac[mac.length - 1] & 15;
  const binary =
    ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a code against the secret, allowing `TOTP_WINDOW` steps of clock drift.
 *
 * Returns the step the code belongs to, or `null`. A code is only accepted for a step
 * *after* `lastUsedStep`, so one that was just used (or an older one) can't be replayed
 * by somebody who watched it being typed.
 */
export async function verifyTotp(
  secret: string,
  input: string,
  nowMs: number,
  lastUsedStep?: number,
): Promise<number | null> {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  let matched: number | null = null;
  // Every candidate is checked, with no early exit, so the time taken doesn't say which one matched.
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const step = current + drift;
    if (timingSafeEqual(await totpCode(secret, step), code) && (lastUsedStep === undefined || step > lastUsedStep)) {
      if (matched === null || step > matched) matched = step;
    }
  }
  return matched;
}

// --- Backup codes -------------------------------------------------------------------------

/** No 0/O/1/I/L: they get misread off a piece of paper. */
const BACKUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const BACKUP_CODE_COUNT = 10;

/** `XXXXX-XXXXX`: 10 characters from a 31-letter alphabet, about 49 bits each. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    let raw = "";
    // Rejection sampling, so no letter is likelier than another.
    while (raw.length < 10) {
      for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
        if (byte < 248 && raw.length < 10) raw += BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length];
      }
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** What is typed, reduced to what is compared: case, dashes and spaces don't matter. */
export function normalizeBackupCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Whether `input` is shaped like a backup code, as opposed to a 6-digit TOTP code. */
export function looksLikeBackupCode(input: string): boolean {
  return normalizeBackupCode(input).length === 10;
}

/**
 * A keyed hash of a backup code, for storing instead of the code.
 *
 * Keyed (HMAC) with a secret from the deployment's environment, because a code is only
 * ~49 bits: a plain hash would fall to guessing the moment the table was read, while an
 * HMAC means whoever reads the table also needs the key.
 */
export async function hashBackupCode(input: string, keyMaterial: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`backup:${normalizeBackupCode(input)}`)),
  );
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Failed attempts ----------------------------------------------------------------------

/** Wrong second-factor codes allowed in a window before the account is locked out of guessing. */
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface AttemptState {
  failures: number;
  windowStart: number;
  lockedUntil?: number;
}

/** Whether guessing is currently locked out, and until when. */
export function lockedOut(state: AttemptState | null, now: number): number | null {
  if (!state?.lockedUntil || state.lockedUntil <= now) return null;
  return state.lockedUntil;
}

/** The state after one more wrong code. Five in a window locks guessing for a while. */
export function afterFailure(state: AttemptState | null, now: number): AttemptState {
  const fresh = !state || now - state.windowStart > ATTEMPT_WINDOW_MS;
  const failures = fresh ? 1 : state.failures + 1;
  const windowStart = fresh ? now : state.windowStart;
  return failures >= MAX_FAILED_ATTEMPTS
    ? { failures: 0, windowStart: now, lockedUntil: now + LOCKOUT_MS }
    : { failures, windowStart };
}

/**
 * How long a verified code keeps administrative functions unlocked on that session.
 *
 * Short on purpose: it is the "sudo window". A code per click would mean a 30-second wait between
 * two admin actions (a TOTP code can't be used twice) and a prompt on every button; five minutes
 * is long enough to do a task and short enough that a walked-away-from console locks itself.
 */
export const STEP_UP_TTL_MS = 5 * 60 * 1000;
