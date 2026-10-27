/**
 * What a community says about a game server to the people who might play on it:
 * a name, a picture, a description, the game and its version, where to connect,
 * and — for Minecraft — the loader and whatever has to be installed to join.
 *
 * Pure, so the server checks it on the way in and the editor can show the same
 * limits. Everything here is text a manager typed or a link they pasted and is
 * shown to other people, so it is trimmed, capped and matched against a pattern
 * rather than stored as sent. A link is only ever *shown and opened by the
 * person who clicks it*; nothing here is fetched by Crystal or run.
 */

export const MINECRAFT_LOADERS = [
  "vanilla",
  "fabric",
  "forge",
  "neoforge",
  "quilt",
  "paper",
  "purpur",
  "spigot",
  "folia",
  "velocity",
] as const;
export type MinecraftLoader = (typeof MINECRAFT_LOADERS)[number];

/** How each loader is written for people. */
export const LOADER_LABELS: Record<MinecraftLoader, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt",
  paper: "Paper",
  purpur: "Purpur",
  spigot: "Spigot",
  folia: "Folia",
  velocity: "Velocity",
};

/** Loaders that mean the *player* needs mods too, as opposed to a plugin server a
 * vanilla client can join. */
export const MODDED_LOADERS: MinecraftLoader[] = ["fabric", "forge", "neoforge", "quilt"];

export const PROFILE_LIMITS = {
  name: 60,
  description: 400,
  gameName: 40,
  version: 32,
  address: 100,
  packName: 80,
  packs: 10,
} as const;

export interface DownloadLink {
  name: string;
  /** https, and ending in the file's own extension. */
  url: string;
  version?: string;
}

export interface ModpackInfo extends DownloadLink {
  /** `.mrpack` is a Modrinth pack, `.zip` a CurseForge or Prism one. */
  format: "mrpack" | "zip";
  source: "modrinth" | "curseforge" | "other";
  /** The pack's page, for people who want to read about it first. */
  pageUrl?: string;
}

export interface PackInfo extends DownloadLink {
  kind: "resourcepack" | "shader";
  required: boolean;
}

export interface MinecraftInfo {
  loader: MinecraftLoader;
  loaderVersion?: string;
  modpack?: ModpackInfo;
  packs: PackInfo[];
}

export interface ServerProfile {
  displayName?: string;
  description?: string;
  /** Free text: "Minecraft", "Valheim". */
  gameName?: string;
  gameVersion?: string;
  /** `host` or `host:port` — where to point the game. */
  address?: string;
  minecraft?: MinecraftInfo;
}

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const t = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
  return t || undefined;
};

/** `https://…` only, no credentials in it, a sane length. */
export function safeHttpsUrl(raw: unknown, what: string): string {
  if (typeof raw !== "string") throw new Error(`${what} needs a web address.`);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${what} isn't a web address.`);
  }
  if (url.protocol !== "https:") throw new Error(`${what} has to be an https address.`);
  if (url.username || url.password) throw new Error(`Leave the username and password out of ${what.toLowerCase()}.`);
  if (url.href.length > 600) throw new Error(`${what} is too long.`);
  return url.href;
}

/** The extension at the end of a URL's path, ignoring the query. */
export function fileExtension(url: string): string {
  try {
    return (new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  } catch {
    return "";
  }
}

/** Where a link points, for showing the person about to click it. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function sourceOf(url: string): ModpackInfo["source"] {
  const host = hostOf(url);
  if (host === "cdn.modrinth.com" || host.endsWith(".modrinth.com") || host === "modrinth.com") return "modrinth";
  if (host.endsWith("forgecdn.net") || host.endsWith("curseforge.com")) return "curseforge";
  return "other";
}

/** `host`, `host:port`, or an IPv4 — a game address, never a URL. */
export function normalizeAddress(raw: unknown): string | undefined {
  const t = text(raw, PROFILE_LIMITS.address);
  if (!t) return undefined;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/i.test(t)) {
    throw new Error("That doesn't look like a server address. Use something like play.example.com or play.example.com:25565.");
  }
  const port = t.split(":")[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new Error("The port has to be between 1 and 65535.");
  return t.toLowerCase();
}

function download(raw: unknown, what: string, extensions: string[]): DownloadLink {
  const r = (raw ?? {}) as Record<string, unknown>;
  const url = safeHttpsUrl(r.url, `${what}'s download`);
  const ext = fileExtension(url);
  if (!extensions.includes(ext)) throw new Error(`${what}'s download has to be a ${extensions.map((e) => `.${e}`).join(" or ")} file.`);
  const name = text(r.name, PROFILE_LIMITS.packName);
  if (!name) throw new Error(`Give ${what.toLowerCase()} a name.`);
  return { name, url, version: text(r.version, PROFILE_LIMITS.version) };
}

/** A profile, rebuilt from what was sent. Anything not understood is dropped, and
 * anything that would be shown to people has to pass the checks above. */
export function normalizeProfile(input: unknown): ServerProfile {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: ServerProfile = {
    displayName: text(raw.displayName, PROFILE_LIMITS.name),
    description: text(raw.description, PROFILE_LIMITS.description),
    gameName: text(raw.gameName, PROFILE_LIMITS.gameName),
    gameVersion: text(raw.gameVersion, PROFILE_LIMITS.version),
    address: normalizeAddress(raw.address),
  };

  if (raw.minecraft) {
    const m = raw.minecraft as Record<string, unknown>;
    if (!(MINECRAFT_LOADERS as readonly string[]).includes(String(m.loader))) throw new Error("Pick one of the loaders in the list.");
    const info: MinecraftInfo = {
      loader: m.loader as MinecraftLoader,
      loaderVersion: text(m.loaderVersion, PROFILE_LIMITS.version),
      packs: [],
    };
    if (m.modpack) {
      const pack = download(m.modpack, "The modpack", ["mrpack", "zip"]);
      const mp = m.modpack as Record<string, unknown>;
      info.modpack = {
        ...pack,
        format: fileExtension(pack.url) === "mrpack" ? "mrpack" : "zip",
        source: sourceOf(pack.url),
        pageUrl: mp.pageUrl ? safeHttpsUrl(mp.pageUrl, "The modpack's page") : undefined,
      };
    }
    const packs = Array.isArray(m.packs) ? m.packs.slice(0, PROFILE_LIMITS.packs) : [];
    info.packs = packs.map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      const link = download(r, "A pack", ["zip", "mrpack"]);
      return { ...link, kind: r.kind === "shader" ? ("shader" as const) : ("resourcepack" as const), required: r.required === true };
    });
    out.minecraft = info;
  }
  return out;
}
