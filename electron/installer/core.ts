import * as nodePath from "node:path";
import yaml from "js-yaml";

import { appIdentity, type AppKind, type ChannelDefinition } from "../channels";

/**
 * What the installer decides, kept apart from what it does (download, run, copy) so it can be tested without a network,
 * a disk or a particular operating system: which file is the right one to fetch, where each app goes, and what the
 * platform's own installer wants to be told.
 */

export type Platform = "win32" | "darwin" | "linux";
export type ComponentId = "crystal" | "studio";

export interface ComponentInfo {
  id: ComponentId;
  kind: AppKind;
  /** What the person is shown. */
  title: string;
  blurb: string;
}

export const COMPONENTS: readonly ComponentInfo[] = [
  { id: "crystal", kind: "crystal", title: "Crystal", blurb: "Chat, voice and video, communities, and the Marketplace." },
  { id: "studio", kind: "studio", title: "Crystal Studio", blurb: "Design cosmetics and build bots and extensions, then publish them." },
];

export const isPlatform = (p: string): p is Platform => p === "win32" || p === "darwin" || p === "linux";

/**
 * The update-metadata file a release carries for an app on a platform. electron-builder writes `latest*.yml` for Crystal
 * and, because Crystal Studio's feed channel is "studio", `studio*.yml` for Studio (see scripts/electron-builder-config.cjs).
 * They list the installer files with their SHA-512 and size, which is exactly what is needed to fetch one and trust it.
 */
export function metadataName(kind: AppKind, platform: Platform): string {
  const base = kind === "studio" ? "studio" : "latest";
  return platform === "darwin" ? `${base}-mac.yml` : platform === "linux" ? `${base}-linux.yml` : `${base}.yml`;
}

export interface MetadataFile {
  /** As written in the metadata: a file name beside it, not a URL. */
  url: string;
  /** Base64, as electron-builder writes it. */
  sha512: string;
  size: number;
}

/** Throws, with a message fit to show, if the file isn't metadata: an installer that can't check what it downloads doesn't download it. */
export function parseMetadata(text: string): MetadataFile[] {
  let doc: { files?: { url?: unknown; sha512?: unknown; size?: unknown }[] } | null;
  try {
    doc = yaml.load(text) as typeof doc;
  } catch {
    throw new Error("The release's file list couldn't be read.");
  }
  const out: MetadataFile[] = [];
  for (const f of doc?.files ?? []) {
    if (typeof f?.url === "string" && typeof f.sha512 === "string") out.push({ url: f.url, sha512: f.sha512, size: Number(f.size) || 0 });
  }
  return out;
}

/** The file to install from. A Mac gets the zip (the .app, ready to copy; no disk image to mount), Windows the NSIS setup, Linux the AppImage. */
export function pickInstaller(files: readonly MetadataFile[], platform: Platform): MetadataFile | null {
  const ext = platform === "darwin" ? ".zip" : platform === "linux" ? ".appimage" : ".exe";
  return files.find((f) => decodeURIComponent(f.url).toLowerCase().endsWith(ext)) ?? null;
}

/** Why this computer can't have the apps, if it can't. Only Apple Silicon builds of the Mac apps exist. */
export function unsupportedReason(platform: Platform, arch: string): string | null {
  if (platform === "darwin" && arch !== "arm64") return "Crystal for Mac is built for Apple Silicon. This Mac has an Intel processor.";
  if (platform === "win32" && arch !== "x64" && arch !== "arm64") return "Crystal for Windows needs a 64-bit processor.";
  if (platform === "linux" && arch !== "x64") return "Crystal for Linux is built for 64-bit Intel and AMD processors.";
  return null;
}

/**
 * The folder the apps are installed into, before the person changes it. Windows and Linux put each app in a folder of its
 * own beneath it; macOS puts the .apps directly in it. macOS uses the shared /Applications when this person may write
 * there (an administrator, which is nearly every Mac user) and their own folder otherwise.
 */
export function defaultBase(platform: Platform, env: Record<string, string | undefined>, home: string, canWriteApplications: boolean): string {
  if (platform === "win32") return nodePath.win32.join(env.LOCALAPPDATA || nodePath.win32.join(home, "AppData", "Local"), "Programs");
  if (platform === "darwin") return canWriteApplications ? "/Applications" : nodePath.posix.join(home, "Applications");
  return nodePath.posix.join(home, "Applications");
}

const pathFor = (platform: Platform) => (platform === "win32" ? nodePath.win32 : nodePath.posix);

/** Windows' own installer is told the final folder, which it then fills; the rest are placed by name inside the base. */
export function componentDir(platform: Platform, base: string, productName: string): string {
  return pathFor(platform).join(base, productName);
}

/** Where the app that launches is, once installed. */
export function launchTarget(platform: Platform, base: string, productName: string, fileName: string): string {
  const p = pathFor(platform);
  if (platform === "win32") return p.join(componentDir(platform, base, productName), `${productName}.exe`);
  if (platform === "darwin") return p.join(base, `${productName}.app`);
  return p.join(base, `${fileName}.AppImage`);
}

/**
 * Arguments to the NSIS setup electron-builder made. `/S` is silent; `/D` sets the folder and has to be last, unquoted
 * (it is read as the rest of the command line, spaces and all).
 */
export const nsisArgs = (dir: string): string[] => ["/S", `/D=${dir}`];

export interface DesktopEntryInput {
  name: string;
  comment: string;
  exec: string;
  icon: string;
  /** Without the `://`. */
  scheme: string;
  /** The window class, so the taskbar groups the app's windows under its entry. */
  wmClass: string;
}

/** A freedesktop launcher for an AppImage placed by the installer (an AppImage on its own makes no menu entry). */
export function desktopEntry(i: DesktopEntryInput): string {
  const quote = (s: string) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`;
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${i.name}`,
    `Comment=${i.comment}`,
    `Exec=${quote(i.exec)} %U`,
    `Icon=${i.icon}`,
    "Terminal=false",
    "Categories=Network;Chat;",
    `MimeType=x-scheme-handler/${i.scheme};`,
    `StartupWMClass=${i.wmClass}`,
    "",
  ].join("\n");
}

/** Whether a downloaded file's SHA-512 (base64) is the one the release promised. Constant-shape compare of two short strings. */
export function digestMatches(expectedBase64: string, actualBase64: string): boolean {
  if (expectedBase64.length !== actualBase64.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedBase64.length; i++) diff |= expectedBase64.charCodeAt(i) ^ actualBase64.charCodeAt(i);
  return diff === 0;
}

export { formatBytes } from "./format";

/** What an app is called on this channel (the installer is built per channel, like the apps). */
export const productNameFor = (channel: ChannelDefinition, kind: AppKind): string => appIdentity(channel, kind).productName;

/** A file name that can't climb out of the folder it is saved in, or name a device on Windows. */
export function safeFileName(name: string): string {
  const base = decodeURIComponent(name).split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "_");
  return cleaned || "download";
}
