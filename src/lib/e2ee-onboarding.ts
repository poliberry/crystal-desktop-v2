/**
 * Small, dependency-free helpers for the encryption onboarding prompt, kept apart from the dialog
 * itself so anything (the command palette, the sign-up screen) can ask for it without pulling the
 * dialog's code into its own bundle.
 *
 * Nothing secret is stored here: only "this window just made an account" and "the person said not
 * now", both in sessionStorage, so they last until the app is closed and never leave the device.
 */

/** Dispatched on `window` to open the encryption setup/unlock prompt. */
export const OPEN_E2EE_SETUP_EVENT = "crystal:open-e2ee-setup";

const NEW_ACCOUNT_KEY = "crystal:e2ee-onboarding:new-account";
const DISMISSED_PREFIX = "crystal:e2ee-onboarding:dismissed:";

export function openE2eeSetup(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_E2EE_SETUP_EVENT));
}

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Called by the sign-up screen right before the new session starts, so the prompt can greet a new account. */
export function markNewAccount(): void {
  session()?.setItem(NEW_ACCOUNT_KEY, "1");
}

export function isNewAccount(): boolean {
  return session()?.getItem(NEW_ACCOUNT_KEY) === "1";
}

export function clearNewAccount(): void {
  session()?.removeItem(NEW_ACCOUNT_KEY);
}

/** "Not now" lasts for this run of the app only: the prompt comes back next launch. */
export function dismissForSession(userId: string): void {
  session()?.setItem(DISMISSED_PREFIX + userId, String(Date.now()));
}

export function isDismissedForSession(userId: string): boolean {
  return !!session()?.getItem(DISMISSED_PREFIX + userId);
}
