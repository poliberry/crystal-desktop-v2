import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The banned-words check for names: usernames, display names, community nicknames and community
 * names. It enforces Guideline 3 ("Keep it safe for work") on what everyone sees before they've
 * read a single message. The list lives in the `bannedWords` table so staff can change it without
 * a release.
 *
 * Names are folded before they're compared, so the obvious dodges don't work: case, accents,
 * look-alike digits and symbols ("p0rn", "pørn", "p@rn"), and separators ("p.o.r.n", "p o r n").
 * A `contains` entry is looked for in the name with every separator removed. A `word` entry only
 * matches a whole word, for short terms that are part of innocent words; it can't see inside a
 * username with no separators, which is the price of not refusing "Essex".
 *
 * The refusal never quotes the word it found. Saying which one would turn the check into a way to
 * read the list.
 */

/** Characters that stand in for letters. Applied after lowercasing and stripping accents. */
const LOOKALIKES: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  "+": "t",
  "8": "b",
  "9": "g",
  ø: "o",
  ß: "ss",
  æ: "ae",
  œ: "oe",
};

/** Lowercased, accents removed, look-alikes replaced; separators kept (as spaces) so words still split. */
function foldKeepingWords(text: string): string {
  const base = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  let out = "";
  for (const ch of base) {
    const swapped = LOOKALIKES[ch] ?? ch;
    out += /[a-z]/.test(swapped) ? swapped : " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** What a list entry is stored as, and what names are compared in: letters only. */
export function foldBannedWord(text: string): string {
  return foldKeepingWords(text).replace(/ /g, "");
}

/** Runs of one letter squashed to one: "poooorn" → "porn". */
const squash = (s: string): string => s.replace(/([a-z])\1+/g, "$1");

type Folded = { joined: string; words: Set<string> };

/**
 * Whether an entry is in the name. Stretched letters ("poooorn") are caught by squashing the name,
 * but only for entries with no doubled letter of their own: squashing one that has would shorten it
 * into something far more common.
 */
function matches(entry: Pick<Doc<"bannedWords">, "word" | "match">, name: Folded, squashed: Folded): boolean {
  const target = entry.word;
  if (!target) return false;
  const stretchable = squash(target) === target;
  if (entry.match === "word") return name.words.has(target) || (stretchable && squashed.words.has(target));
  return name.joined.includes(target) || (stretchable && squashed.joined.includes(target));
}

/** Whether `text` contains anything on the list. */
export function containsBannedWord(text: string, list: Pick<Doc<"bannedWords">, "word" | "match">[]): boolean {
  if (list.length === 0) return false;
  const parts = foldKeepingWords(text).split(" ").filter(Boolean);
  const name: Folded = { joined: parts.join(""), words: new Set(parts) };
  const squashed: Folded = { joined: squash(name.joined), words: new Set(parts.map(squash)) };
  return list.some((entry) => matches(entry, name, squashed));
}

export type NameKind = "username" | "display name" | "nickname" | "community name";

/**
 * Why `text` can't be used as a `kind`, or `null`. Checks the list only; shape, length and
 * whether it's taken are checked by the caller.
 */
export async function bannedNameProblem(ctx: QueryCtx, text: string, kind: NameKind): Promise<string | null> {
  if (!text.trim()) return null;
  const list = await ctx.db.query("bannedWords").collect();
  if (!containsBannedWord(text, list)) return null;
  return `That ${kind} isn't allowed. Names on Crystal have to follow the community guidelines.`;
}

/** As `bannedNameProblem`, but throws. For mutations that report problems by throwing. */
export async function assertNameAllowed(ctx: QueryCtx, text: string, kind: NameKind): Promise<void> {
  const problem = await bannedNameProblem(ctx, text, kind);
  if (problem) throw new Error(problem);
}
