/**
 * The rules of signing in that need no database: what an address and a password have to look
 * like, and the emailed codes. WebCrypto only, so it runs in the Convex runtime and under `bun`
 * in scripts/tests/auth-policy.test.mts.
 */

// --- Addresses --------------------------------------------------------------------------------

/** How an address is compared and stored: trimmed and lowercased. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Deliberately loose: the only real test of an address is whether the code arrives. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);
}

// --- Passwords --------------------------------------------------------------------------------

export const PASSWORD_MIN = 10;
/** Hashing cost grows with length, so an absurdly long one is refused rather than hashed. */
export const PASSWORD_MAX = 256;

/** Why a password isn't acceptable, or `null` if it is. Phrased for the person typing it. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (email && password.toLowerCase() === email.toLowerCase()) return "Your password can't be your email address.";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase() === local) return "Your password can't be your email name.";
  if (/^(.)\1+$/.test(password)) return "Use more than one repeated character.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "That password is too common. Pick something else.";
  return null;
}

/** A short list of the passwords everyone tries first, for those long enough to pass the length rule. */
const COMMON_PASSWORDS = new Set([
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "1234567890",
  "12345678910",
  "0123456789",
  "qwertyuiop",
  "qwerty12345",
  "qwerty123456",
  "iloveyou123",
  "letmein1234",
  "welcome1234",
  "abcdefghij",
  "abc1234567",
  "1q2w3e4r5t",
  "changeme123",
  "administrator",
  "crystal1234",
  "crystalapp",
]);

// --- Usernames ----

export const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;
export const DISPLAY_NAME_MAX = 64;

/** Why a username can't be used, or `null`. Lowercase it first; this is about shape, not whether it is taken. */
export function usernameProblem(username: string): string | null {
  if (!USERNAME_RE.test(username)) return 'Usernames are 3–32 characters: lowercase letters, numbers, "." or "_".';
  if (/^[._]|[._]$/.test(username)) return 'A username can\'t start or end with "." or "_".';
  if (/[._]{2,}/.test(username)) return 'A username can\'t have "." or "_" next to each other.';
  if (RESERVED_USERNAMES.has(username)) return "That username is reserved.";
  return null;
}

/** Names that would pass for Crystal itself or for staff. */
const RESERVED_USERNAMES = new Set(["crystal", "admin", "administrator", "staff", "support", "moderator", "mod", "system", "official", "everyone", "here", "null", "undefined"]);

// --- Derived names ------------------------------------------------------------------------------

/** A starting username for somebody new, from the part of their address before the `@`. */
export function usernameFromEmail(email: string): string {
  const base = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 28);
  if (base.length >= 3) return base;
  return `user${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

/** A display name from the same place: the part before the `@`, as typed. */
export function displayNameFromEmail(email: string): string {
  return (email.split("@")[0] ?? "").slice(0, 64) || "New user";
}

// --- Emailed codes ----------------------------------------------------------------------------

/** How long an emailed code works, how long to wait between requests, and how many an hour. */
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_CODE_COOLDOWN_MS = 45 * 1000;
export const EMAIL_CODES_PER_HOUR = 5;
/** Wrong guesses an emailed code survives. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

/** How long a finished check can wait to be turned into a session, and how long a pending second step stays open. */
export const TICKET_TTL_MS = 2 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** How long a proved address stays good for finishing sign-up: long enough to fill in a profile. */
export const EMAIL_PROOF_TTL_MS = 30 * 60 * 1000;

/** Eight digits. Uniform: values past the last whole multiple of 10^8 are thrown away rather than folded in. */
export function generateEmailCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1e8) * 1e8;
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n < limit) return String(n % 1e8).padStart(8, "0");
  }
}

/** What is typed: digits only, so "1234 5678" and "1234-5678" work. */
export function normalizeEmailCode(input: string): string {
  return input.replace(/\D/g, "");
}

/** The sign-in screen switches on `error.data.code`, so the codes are fixed here and shared with it. */
export const AUTH_ERROR = {
  invalidCredentials: "INVALID_CREDENTIALS",
  /** The account came over from Clerk and has no password yet: the screen moves on to setting one. */
  passwordSetupRequired: "PASSWORD_SETUP_REQUIRED",
  /** The password is right and a second step is needed; `methods` says which are available. */
  secondFactorRequired: "SECOND_FACTOR_REQUIRED",
  secondFactorInvalid: "SECOND_FACTOR_INVALID",
  secondFactorLocked: "SECOND_FACTOR_LOCKED",
  banned: "ACCOUNT_BANNED",
  suspended: "ACCOUNT_SUSPENDED",
  /** Administrative function, and the account has a second step that hasn't been entered recently. */
  stepUpRequired: "STEP_UP_REQUIRED",
  /** Administrative function that requires two-step verification the account doesn't have. */
  twoFactorRequired: "TWO_FACTOR_REQUIRED",
  /** Changing security settings on an account with no second step yet: confirm the password first. */
  passwordRequired: "PASSWORD_REQUIRED",
} as const;

// --- Tokens and hashes ------------------------------------------------------------------------

/** 256 random bits, URL-safe. The shape of every ticket and token. */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256, hex. For things that are already unguessable (tokens), so they can be stored without being usable. */
export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** HMAC-SHA-256, hex. For things that are guessable (8-digit codes), so the table alone isn't enough to read them. */
export async function hmacHex(keyMaterial: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}

/** Compares two strings in time that doesn't depend on where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
