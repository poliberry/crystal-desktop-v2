/**
 * What a step of signing in comes back with. The sign-in screen is a small state machine over
 * these: it shows whatever `status` says comes next, and hands `ticket` to the auth library when
 * it gets one. Shared by the server (convex/authFlow.ts) and the screen, so neither can drift.
 *
 * Nothing in here says whether an address has an account or which half of a credential was wrong:
 * a wrong password and an unknown address are both `invalid`.
 */
export type SignInStep =
  /** Every check passed. Give `ticket` to the auth library's `signIn` to start the session. */
  | { status: "signed_in"; ticket: string }
  /** The first factor was right and a second step is next. `token` ties the answer to this sign-in. */
  | { status: "second_factor"; token: string; methods: SecondFactorMethods }
  /** The account can't sign in: banned, or suspended. Shown before any session exists. */
  | {
      status: "blocked";
      kind: "banned" | "suspended";
      reason?: string;
      /** When a suspension ends; absent for a ban and for an indefinite suspension. */
      until?: number;
      indefinite?: boolean;
    }
  /** Wrong address, password or code. */
  | { status: "invalid"; message?: string }
  /** Too many wrong tries; guessing is paused until this time (ms since the epoch). */
  | { status: "locked"; until: number }
  /** The sign-in this belonged to has expired. Start again. */
  | { status: "expired" };

export interface SecondFactorMethods {
  totp: boolean;
  passkey: boolean;
  /** Backup codes are accepted wherever a code is. */
  backup: boolean;
}

/** Where an address stands, for choosing which screen comes next. */
export type AddressState =
  /** An account with a password: ask for it. */
  | "password"
  /** An account with no password yet (it came over from Clerk): prove the address, then choose one. */
  | "setup"
  /** Nobody has this address: prove it, then choose a password to open an account. */
  | "signup"
  | "invalid_email";
