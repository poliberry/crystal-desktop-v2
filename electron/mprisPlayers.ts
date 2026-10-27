import { readFile, readlink } from "node:fs/promises";
import path from "node:path";

/**
 * Deciding which MPRIS players count as "music" for Rich Presence.
 *
 * Kept free of any `electron` import so it can be unit-tested directly.
 *
 * A player's *name* is a poor way to tell a browser from a desktop app:
 * Chromium's built-in media session registers every Chromium-based process —
 * Chrome, but also any Electron wrapper such as a desktop YouTube Music
 * client — as `chromium.instance<PID>`. Filtering on that name drops the
 * wrapper along with the browsers. So when a name *looks* like a browser (or
 * like us) we look at the process behind the bus name instead and judge its
 * executable.
 */

/** Lowercased, stripped of everything that isn't a letter or digit, so an
 * AUMID ("dev.crystal.desktop.canary!App"), a bus name and a bare executable
 * all compare on the same footing. */
export function identityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Browsers publish every tab's media element as an MPRIS/SMTC session. The
 * desktop media APIs do not tell us whether that tab is playing music, a
 * video, a voice message, or an advert, so browser sessions are not reliable
 * Rich Presence activities. Keep this separate from `isOwnPlayback`: a
 * Chromium-based Crystal build must be excluded as our own app as well as
 * matching the browser family catch-all.
 */
export const BROWSER_MEDIA_IDS = new Set([
  "brave",
  "chromium",
  "chrome",
  "epiphany",
  "falkon",
  "firefox",
  "floorp",
  "googlechrome",
  "librewolf",
  "midori",
  "microsoftedge",
  "msedge",
  "opera",
  "operagx",
  "qutebrowser",
  "thorium",
  "vivaldi",
  "waterfox",
  "yandexbrowser",
]);

export function isBrowserPlayback(rawSource: string | undefined): boolean {
  if (!rawSource) return false;
  const tokens = rawSource.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const compact = identityKey(rawSource);
  return tokens.some((token) => BROWSER_MEDIA_IDS.has(token)) ||
    [...BROWSER_MEDIA_IDS].some((browser) => compact.startsWith(browser));
}

// --- process-based classification -------------------------------------------

/** What a bus name's process turned out to be.
 *  - `allow`   a desktop app that is neither a browser nor us
 *  - `own`     Crystal itself (any channel)
 *  - `browser` a web browser
 *  - `unknown` we couldn't tell, so callers must stay conservative and drop it */
export type PlayerVerdict = "allow" | "own" | "browser" | "unknown";

export interface ProcessIdentity {
  /** Resolved `/proc/<pid>/exe` target, if readable. */
  exe?: string;
  /** First element of `/proc/<pid>/cmdline`, if readable. */
  argv0?: string;
}

/**
 * Sandbox helpers that stand in for the real app on the bus. A Flatpak or Snap
 * app reaches the session bus through one of these, so the pid D-Bus reports
 * belongs to the proxy and says nothing about what is behind it.
 */
const SANDBOX_PROXY_KEYS = ["xdgdbusproxy", "bwrap", "bubblewrap", "snapconfine"];

/** The `<PID>` in `chromium.instance<PID>` (or Firefox's `firefox.instance_<PID>_<n>`). */
export function parseInstancePid(playerName: string): number | undefined {
  const match = /\.instance_?(\d+)/.exec(playerName);
  if (!match) return undefined;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** Parses `busctl call … GetConnectionUnixProcessID` output (`u 12345`). */
export function parseBusctlPid(output: string): number | undefined {
  const match = /^\s*u\s+(\d+)/.exec(output);
  if (!match) return undefined;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** `/opt/x/chrome (deleted)` is what readlink reports after a package upgrade
 * replaced the binary under a running process. */
function executableName(file: string): string {
  return path.posix.basename(file.replace(/\\/g, "/").replace(/ \(deleted\)$/, ""));
}

/** The executable's file name, preferring the resolved `exe` and falling back to
 * `argv[0]`: `/proc/<pid>/exe` is unreadable for a process that marked itself
 * non-dumpable, while `cmdline` is world-readable. */
export function processExecutableName(identity: ProcessIdentity): string | undefined {
  const file = identity.exe ?? identity.argv0;
  return file ? executableName(file) || undefined : undefined;
}

export function classifyProcess(input: {
  pid: number;
  ownPid: number;
  identity: ProcessIdentity;
  /** `identityKey`s of Crystal's executable names (every channel and Studio). */
  ownExeKeys: readonly string[];
}): PlayerVerdict {
  const { pid, ownPid, identity, ownExeKeys } = input;
  if (pid === ownPid) return "own";

  const exeName = processExecutableName(identity);
  const exeKey = exeName ? identityKey(exeName) : "";
  if (!exeKey) return "unknown";
  if (SANDBOX_PROXY_KEYS.some((proxy) => exeKey.includes(proxy))) return "unknown";

  if (ownExeKeys.some((own) => own && exeKey.includes(own))) return "own";

  const argv0Name = identity.argv0 ? executableName(identity.argv0) : undefined;
  if (isBrowserPlayback(exeName) || isBrowserPlayback(argv0Name)) return "browser";
  return "allow";
}

/** Parses `busctl get-property …` output for a string property (`s "Value"`). */
export function parseBusctlString(output: string): string | undefined {
  const match = /^s "((?:[^"\\]|\\.)*)"\s*$/.exec(output.trim());
  if (!match) return undefined;
  return match[1].replace(/\\(.)/g, "$1") || undefined;
}

/**
 * Pick a human-readable app name for a player whose bus name is just
 * `chromium`. Candidates come in order of preference (MPRIS `Identity`, the
 * `DesktopEntry`, the executable); generic runtime names are skipped, since
 * "Chromium" or "electron" describes the framework rather than the app.
 */
export function pickDisplayName(candidates: readonly (string | undefined)[]): string | undefined {
  return candidates.find((candidate): candidate is string => {
    if (!candidate?.trim()) return false;
    return !isBrowserPlayback(candidate) && identityKey(candidate) !== "electron";
  });
}

/** Best-effort read of the executable behind `pid`. Never throws. */
export async function readProcessIdentity(pid: number): Promise<ProcessIdentity> {
  const [exe, cmdline] = await Promise.all([
    readlink(`/proc/${pid}/exe`).catch(() => undefined),
    readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => undefined),
  ]);
  const argv0 = cmdline?.split("\0")[0] || undefined;
  return { exe, argv0 };
}
