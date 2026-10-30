/**
 * The decisions behind updating while the app starts (see `Updater.runLaunchUpdate`). No Electron in here, so they can be
 * tested on their own.
 */

/** A launch-time install that was started: which version, and when. Written just before the app quits to install it. */
export interface InstallAttempt {
  version: string;
  at: number;
}

/**
 * After an install has been tried for a version, the launch flow leaves that version alone for a while.
 *
 * Without this, an update that cannot be applied — an unsigned macOS build that Squirrel refuses, a package that fails
 * its signature check, a disk that is read-only — would be downloaded and "installed" on every launch, and the app would
 * quit and reopen into the same splash forever. Inside the window the update is still offered in the usual places (the
 * topbar, Settings → Updates), where the person chooses and sees any error.
 */
export const INSTALL_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

export function shouldAutoInstall(version: string | null, attempt: InstallAttempt | null, now: number): boolean {
  if (!version) return false;
  if (!attempt || attempt.version !== version) return true;
  return now - attempt.at >= INSTALL_RETRY_AFTER_MS;
}

/** What a download looks like on the splash. */
export function downloadStatus(version: string | null, percent: number | null): string {
  const what = version ? `Downloading v${version}` : "Downloading update";
  return percent == null ? `${what}…` : `${what} — ${percent}%`;
}

export function parseAttempt(raw: string): InstallAttempt | null {
  try {
    const value = JSON.parse(raw) as Partial<InstallAttempt>;
    return typeof value.version === "string" && typeof value.at === "number" ? { version: value.version, at: value.at } : null;
  } catch {
    return null;
  }
}
