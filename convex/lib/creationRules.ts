/**
 * The rules about what may be listed in the Marketplace and under what name, kept free of the database so they are tested on
 * their own (scripts/tests/staff-publish.test.mts) and shared by every way something gets listed: a creator's submission and
 * staff publishing directly.
 */

/** What is bought by a community rather than a person: never sold in a pack. */
export const COMMUNITY_CREATION_KINDS: readonly string[] = ["communityTheme", "loungeScene"];
/** The most things one pack can hold. */
export const MAX_PACK_ITEMS = 8;
export const MIN_PAID_CENTS = 50;
export const MAX_CREATION_CENTS = 50_000;

export interface CreationShape {
  name: string;
  description?: string;
  priceCents: number;
  /** Whether the currency is one the store sells in. */
  currencyOk: boolean;
  /** The kind of each item. */
  kinds: string[];
}

/** Throws a sentence for what can't be listed; otherwise the name and description as they are to be stored. */
export function checkCreationShape(a: CreationShape): { name: string; description: string } {
  const name = a.name.trim();
  if (name.length < 2 || name.length > 60) throw new Error("A name is 2–60 characters.");
  const description = a.description?.trim() ?? "";
  if (description.length > 400) throw new Error("A description is up to 400 characters.");
  if (!Number.isInteger(a.priceCents) || a.priceCents < 0 || a.priceCents > MAX_CREATION_CENTS || (a.priceCents > 0 && a.priceCents < MIN_PAID_CENTS)) {
    throw new Error("Price must be free, or between 0.50 and 500.00.");
  }
  if (!a.currencyOk) throw new Error("Unsupported currency.");
  if (a.kinds.length < 1 || a.kinds.length > MAX_PACK_ITEMS) throw new Error(`A submission holds between 1 and ${MAX_PACK_ITEMS} things.`);
  // A scene is bought by a community and a cosmetic by a person; a single item can't be both, so a community kind is only ever sold on its own.
  if (a.kinds.length > 1 && a.kinds.some((k) => COMMUNITY_CREATION_KINDS.includes(k))) throw new Error("Scenes and community themes are sold on their own, not in a pack.");
  // Two of one kind in a pack would fight over the same slot on a profile.
  if (new Set(a.kinds).size !== a.kinds.length) throw new Error("A pack can hold one of each kind of thing.");
  return { name, description };
}

/** `Neon Sparkle Pack!` → `neon-sparkle-pack`: the form a store address takes (lower-case words and hyphens, at most 40). */
export function slugFromName(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "item";
}

/** The first of `base`, `base-2`, `base-3`… that `taken` says is free. Gives up after a few hundred rather than loop. */
export async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const stem = base.slice(0, 36);
  for (let n = 1; n <= 500; n++) {
    const candidate = n === 1 ? base : `${stem}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error("Couldn't find a free address for that name. Try a different name.");
}

/** What a listing says about who made it: staff-published listings are Crystal's, everything else is its creator's. */
export function authorLabel(sku: { byCrystal?: boolean; creator?: { username: string } | null }): { kind: "crystal" } | { kind: "creator"; username: string } | { kind: "none" } {
  if (sku.byCrystal) return { kind: "crystal" };
  return sku.creator ? { kind: "creator", username: sku.creator.username } : { kind: "none" };
}
