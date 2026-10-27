/**
 * Looking up a modpack or resource pack on Modrinth, from a link a manager pasted.
 *
 * Only `api.modrinth.com` is ever asked, and only for the one project named in the
 * link; the file it hands back has to be on Modrinth's own CDN. Nothing is
 * downloaded here — Crystal learns the name, the version and where the file is,
 * and the *player's* launcher fetches it, if they choose to.
 */

import type { MinecraftLoader } from "./serverProfile";
import { fileExtension, hostOf } from "./serverProfile";

const API = "https://api.modrinth.com/v2";
/** Modrinth asks every client to identify itself. */
const USER_AGENT = "crystal-app/crystal/1.0 (https://usecrystal.app)";
const TIMEOUT_MS = 8000;

export interface ModrinthResult {
  kind: "modpack" | "resourcepack" | "shader" | "mod" | "other";
  title: string;
  slug: string;
  iconUrl?: string;
  pageUrl: string;
  version: string;
  gameVersion?: string;
  loader?: MinecraftLoader;
  file: { url: string; filename: string };
}

async function get<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: controller.signal });
    if (res.status === 404) throw new Error("Modrinth doesn't have that project.");
    if (!res.ok) throw new Error("Modrinth didn't answer. Try again in a moment.");
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Modrinth took too long to answer.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** The slug and kind in a `modrinth.com/<kind>/<slug>` link. */
export function parseModrinthLink(raw: string): { slug: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Paste a link from modrinth.com.");
  }
  if (url.protocol !== "https:" || (url.hostname !== "modrinth.com" && url.hostname !== "www.modrinth.com")) {
    throw new Error("Paste a link from modrinth.com.");
  }
  const m = url.pathname.match(/^\/(?:mod|modpack|resourcepack|shader|plugin|datapack)\/([A-Za-z0-9_-]{2,64})(?:\/|$)/);
  if (!m) throw new Error("That doesn't look like a Modrinth project page.");
  return { slug: m[1] };
}

const LOADERS: Record<string, MinecraftLoader> = {
  fabric: "fabric",
  forge: "forge",
  neoforge: "neoforge",
  quilt: "quilt",
  paper: "paper",
  purpur: "purpur",
  spigot: "spigot",
  folia: "folia",
  velocity: "velocity",
};

export async function lookupModrinth(link: string): Promise<ModrinthResult> {
  const { slug } = parseModrinthLink(link);
  const project = await get<{ slug: string; title: string; icon_url?: string; project_type: string }>(`/project/${slug}`);
  const versions = await get<
    {
      version_number: string;
      version_type: string;
      game_versions: string[];
      loaders: string[];
      files: { url: string; filename: string; primary?: boolean }[];
    }[]
  >(`/project/${slug}/version`);
  if (versions.length === 0) throw new Error("That project has no released versions.");
  // Newest first, preferring a proper release to a beta.
  const version = versions.find((v) => v.version_type === "release") ?? versions[0];
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error("That version has no file to download.");
  if (hostOf(file.url) !== "cdn.modrinth.com") throw new Error("Modrinth gave a file address Crystal doesn't trust.");
  if (!["mrpack", "zip"].includes(fileExtension(file.url))) throw new Error("That project's file isn't a .mrpack or .zip, so a launcher can't install it as a pack.");

  const kind =
    project.project_type === "modpack" ? "modpack" : project.project_type === "resourcepack" ? "resourcepack" : project.project_type === "shader" ? "shader" : project.project_type === "mod" ? "mod" : "other";
  const loader = version.loaders.map((l) => LOADERS[l]).find(Boolean);
  return {
    kind,
    title: project.title,
    slug: project.slug,
    iconUrl: project.icon_url,
    pageUrl: `https://modrinth.com/${project.project_type}/${project.slug}`,
    version: version.version_number,
    // Modrinth lists every game version a file works with; the newest is the one to show.
    gameVersion: version.game_versions[version.game_versions.length - 1],
    loader,
    file: { url: file.url, filename: file.filename },
  };
}
