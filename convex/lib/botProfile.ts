import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { BOT_LIMITS } from "./botAuth";
import { approvedBotFields, type BotUpdatePlan, type PendingBotListing, planWrites } from "./listingUpdate";

/**
 * Writing what is shown about a bot onto its account (the `users` row people actually see: in member lists, on its profile
 * card). One place does it, for a change made in Studio, a change made through the Bot API and an approval by staff, so that
 * they leave the account in the same state: a new picture replaces the old one's stored copy instead of leaving it behind, and
 * a cropped-original or colour that belonged to the old picture isn't left describing the new one.
 */
export async function writeAccount(ctx: MutationCtx, account: Doc<"users"> | null, writes: Record<string, unknown>, storage: { avatar?: Doc<"users">["avatarStorageId"]; banner?: Doc<"users">["bannerStorageId"] } = {}): Promise<void> {
  if (!account || Object.keys(writes).length === 0 && !storage.avatar && !storage.banner) return;
  const patch: Record<string, unknown> = { ...writes };
  const drop: (Doc<"users">["avatarStorageId"])[] = [];
  if ("imageUrl" in writes || storage.avatar) {
    for (const old of [account.avatarStorageId, account.avatarOriginalStorageId]) if (old && old !== storage.avatar) drop.push(old);
    patch.avatarStorageId = storage.avatar;
    patch.avatarOriginalUrl = undefined;
    patch.avatarOriginalStorageId = undefined;
    patch.avatarAccent = undefined;
    patch.avatarAccentUrl = undefined;
  }
  if ("bannerUrl" in writes || storage.banner) {
    for (const old of [account.bannerStorageId, account.bannerOriginalStorageId]) if (old && old !== storage.banner) drop.push(old);
    patch.bannerStorageId = storage.banner;
    patch.bannerOriginalUrl = undefined;
    patch.bannerOriginalStorageId = undefined;
  }
  await ctx.db.patch(account._id, patch as Partial<Doc<"users">>);
  for (const id of drop) if (id) await ctx.storage.delete(id).catch(() => undefined);
}

/** Write a plan's applied half onto the bot and its account. Returns what was written to the bot row, for the caller to merge into its own patch. */
export async function applyPlan(ctx: MutationCtx, account: Doc<"users"> | null, plan: BotUpdatePlan, now: number, storage?: Parameters<typeof writeAccount>[3]): Promise<Record<string, unknown>> {
  const writes = planWrites(plan, now);
  await writeAccount(ctx, account, writes.user, storage);
  return writes.bot;
}

/** Staff approved a pending listing: put it live on the bot's account. */
export async function approvePending(ctx: MutationCtx, account: Doc<"users"> | null, pending: PendingBotListing): Promise<ReturnType<typeof approvedBotFields>> {
  const next = approvedBotFields(pending);
  await writeAccount(ctx, account, { name: next.name, imageUrl: next.imageUrl, bio: next.bio || undefined, bannerUrl: next.bannerUrl });
  return next;
}

/** A profile bio: plain text, no control characters, at most `BOT_LIMITS.bioChars`. Throws a sentence if it isn't. */
export function checkBio(text: string): string {
  const b = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(b)) throw new Error("The bio can't contain control characters.");
  if ([...b].length > BOT_LIMITS.bioChars) throw new Error(`The bio is up to ${BOT_LIMITS.bioChars} characters.`);
  return b;
}
