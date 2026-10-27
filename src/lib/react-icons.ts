import type { IconType } from "react-icons";

/**
 * Resolving a react-icons glyph from its export name at runtime.
 *
 * Badges name their icon as a string in the database ("BsFillPersonBadgeFill"),
 * which is the whole point — a new badge is a row rather than a release. The
 * cost is that the name isn't known at build time, so it can't be imported the
 * ordinary way.
 *
 * Each pack is therefore a dynamic `import()`, loaded the first time something
 * asks for a glyph from it and cached after that. A pack is one large module —
 * react-icons has no per-icon entry points in v5 — so this deliberately covers
 * a chosen list rather than all forty of them: every pack named here is a chunk
 * the build has to produce, whether or not any badge ever uses it. Adding one
 * is a line in `PACKS` plus, if its prefix is ambiguous, a line in `PREFIXES`.
 */

const PACKS: Record<string, () => Promise<Record<string, unknown>>> = {
  bs: () => import("react-icons/bs"),
  fa: () => import("react-icons/fa"),
  fa6: () => import("react-icons/fa6"),
  gi: () => import("react-icons/gi"),
  hi2: () => import("react-icons/hi2"),
  io5: () => import("react-icons/io5"),
  lu: () => import("react-icons/lu"),
  md: () => import("react-icons/md"),
  pi: () => import("react-icons/pi"),
  ri: () => import("react-icons/ri"),
  si: () => import("react-icons/si"),
  tb: () => import("react-icons/tb"),
};

/**
 * Which packs a name's prefix could belong to, in the order they're tried.
 *
 * Mostly the prefix *is* the pack, but not always: `FaStar` exists in both
 * `fa` and `fa6`, and `HiStar` in both `hi` and `hi2`. Where they overlap the
 * newer pack goes first and the older one is the fallback, so a name that only
 * one of them has still resolves.
 */
const PREFIXES: Record<string, string[]> = {
  Bs: ["bs"],
  Fa: ["fa6", "fa"],
  Gi: ["gi"],
  Hi: ["hi2"],
  Io: ["io5"],
  Lu: ["lu"],
  Md: ["md"],
  Pi: ["pi"],
  Ri: ["ri"],
  Si: ["si"],
  Tb: ["tb"],
};

const loaded = new Map<string, Promise<Record<string, unknown>>>();

function loadPack(pack: string): Promise<Record<string, unknown>> {
  const existing = loaded.get(pack);
  if (existing) return existing;
  // Cached as the promise rather than the module, so twenty avatars asking for
  // the same glyph at once share one fetch instead of racing to start twelve.
  const work = PACKS[pack]!().catch(() => ({}) as Record<string, unknown>);
  loaded.set(pack, work);
  return work;
}

/** Names are `Xx` or `Xx…` in PascalCase; the prefix is the first two letters. */
function packsFor(name: string): string[] {
  return PREFIXES[name.slice(0, 2)] ?? [];
}

/** Resolved glyphs, including the misses — a name nobody can resolve should be
 * looked for once, not on every render of every card. */
const icons = new Map<string, IconType | null>();

/**
 * The component for `name`, or null if no pack this build knows about has it.
 *
 * Null is a normal answer, not an error: it means a badge defined by a newer
 * build (or with a typo in it) draws nothing rather than breaking the row it
 * was in.
 */
export async function loadReactIcon(name: string): Promise<IconType | null> {
  const cached = icons.get(name);
  if (cached !== undefined) return cached;

  let found: IconType | null = null;
  for (const pack of packsFor(name)) {
    const module = await loadPack(pack);
    const candidate = module[name];
    if (typeof candidate === "function") {
      found = candidate as IconType;
      break;
    }
  }
  icons.set(name, found);
  return found;
}

/** The glyph if it has already been resolved, for a first render that doesn't
 * flash — `undefined` means "not looked up yet", `null` means "no such icon". */
export function cachedReactIcon(name: string): IconType | null | undefined {
  return icons.get(name);
}
