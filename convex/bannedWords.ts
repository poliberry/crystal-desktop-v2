import { v } from "convex/values";

import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { containsBannedWord, foldBannedWord } from "./lib/bannedWords";
import { audit, requireStaff } from "./lib/staff";

/**
 * The banned-words list for names (usernames, display names, nicknames and community names), edited
 * from the admin console. See convex/lib/bannedWords.ts for how names are checked against it.
 *
 * Changing the list only affects names chosen from then on. Names that already exist are left as
 * they are; `test` lets staff see whether one would be refused, and moderation handles the rest.
 */

const matchValidator = v.union(v.literal("contains"), v.literal("word"));
type Match = "contains" | "word";

const WORD_MAX = 48;
const NOTE_MAX = 200;

/**
 * A starting point for Guideline 3 ("Keep it safe for work"): explicit sexual terms. `word` is used
 * for terms that are also parts of everyday words ("sex" in "Essex", "cock" in "peacock", "anal" in
 * "canal"), so they're only refused standing on their own.
 */
const GUIDELINE_3_DEFAULTS: { word: string; match: Match }[] = [
  ...["porn", "hentai", "blowjob", "handjob", "dildo", "milf", "nsfw", "onlyfans", "rule34", "erotic", "fetish", "bdsm", "orgasm", "masturbat", "cumshot", "creampie", "camgirl", "deepthroat", "gangbang", "threesome", "stripclub", "sexting", "nudes", "penis", "vagina", "xvideos", "pornhub", "xhamster"].map(
    (word) => ({ word, match: "contains" as const }),
  ),
  ...["sex", "cum", "cock", "dick", "pussy", "tits", "boobs", "anal", "horny", "nude", "rape", "slut", "whore", "hoe", "jizz", "clit", "cunt"].map((word) => ({ word, match: "word" as const })),
];

async function insertWord(ctx: MutationCtx, raw: string, match: Match, note: string | undefined, addedBy: Parameters<typeof audit>[1]) {
  const word = foldBannedWord(raw);
  if (word.length < 2) throw new Error("A banned word needs at least two letters.");
  if (word.length > WORD_MAX) throw new Error(`Banned words are up to ${WORD_MAX} letters.`);
  const existing = await ctx.db
    .query("bannedWords")
    .withIndex("by_word", (q) => q.eq("word", word))
    .unique();
  if (existing) return { word, added: false };
  await ctx.db.insert("bannedWords", { word, match, note: note?.trim().slice(0, NOTE_MAX) || undefined, addedBy, addedAt: Date.now() });
  return { word, added: true };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "users.moderate");
    const rows = await ctx.db.query("bannedWords").collect();
    return rows
      .map((r) => ({ id: r._id, word: r.word, match: r.match, note: r.note ?? null, addedAt: r.addedAt }))
      .sort((a, b) => a.word.localeCompare(b.word));
  },
});

/** Whether a name would be refused, for checking an entry before or after adding it. */
export const test = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    await requireStaff(ctx, "users.moderate");
    const rows = await ctx.db.query("bannedWords").collect();
    const hits = rows.filter((r) => containsBannedWord(text.slice(0, 200), [r])).map((r) => r.word);
    return { refused: hits.length > 0, hits };
  },
});

export const add = mutation({
  args: { word: v.string(), match: matchValidator, note: v.optional(v.string()) },
  handler: async (ctx, { word, match, note }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const result = await insertWord(ctx, word, match, note, staff.user._id);
    if (!result.added) throw new Error("That word is already on the list.");
    await audit(ctx, staff.user._id, "bannedWords.add", { type: "bannedWord", id: result.word }, `Banned "${result.word}" in names (${match})`);
    return result.word;
  },
});

export const update = mutation({
  args: { id: v.id("bannedWords"), match: v.optional(matchValidator), note: v.optional(v.string()) },
  handler: async (ctx, { id, match, note }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That word isn't on the list.");
    await ctx.db.patch(id, {
      ...(match !== undefined ? { match } : {}),
      ...(note !== undefined ? { note: note.trim().slice(0, NOTE_MAX) || undefined } : {}),
    });
    await audit(ctx, staff.user._id, "bannedWords.update", { type: "bannedWord", id: row.word }, `Changed banned word "${row.word}"${match ? ` to ${match}` : ""}`);
  },
});

export const remove = mutation({
  args: { id: v.id("bannedWords") },
  handler: async (ctx, { id }) => {
    const staff = await requireStaff(ctx, "users.moderate");
    const row = await ctx.db.get(id);
    if (!row) return;
    await ctx.db.delete(id);
    await audit(ctx, staff.user._id, "bannedWords.remove", { type: "bannedWord", id: row.word }, `Unbanned "${row.word}" in names`);
  },
});

/** Add the Guideline 3 starter list. Words already on the list are left as they are. */
export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx, "users.moderate");
    let added = 0;
    for (const { word, match } of GUIDELINE_3_DEFAULTS) {
      if ((await insertWord(ctx, word, match, "Guideline 3 starter list", staff.user._id)).added) added++;
    }
    await audit(ctx, staff.user._id, "bannedWords.seed", { type: "bannedWord", id: "defaults" }, `Added ${added} Guideline 3 words to the names list`);
    return { added };
  },
});
