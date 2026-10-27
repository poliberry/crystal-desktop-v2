import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { displayNameFromEmail, usernameFromEmail } from "./authPolicy";

/**
 * Finding and making the accounts behind sign-in addresses.
 *
 * Kept apart from convex/authInternal.ts so the sign-in flows, `ensureUser` and the Clerk backfill
 * all agree on what an account looks like and on how an address maps to one.
 */

/** A username nobody has, starting from `base` and adding a number until it fits. */
export async function freeUsername(ctx: Pick<QueryCtx, "db">, base: string): Promise<string> {
  let username = base;
  for (let suffix = 1; ; suffix++) {
    const taken = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (!taken) return username;
    username = `${base.slice(0, 28)}${suffix}`;
  }
}

/**
 * The account that signs in with this address, and its address row.
 *
 * Bots and the system account never have an address row, so they can't be reached from here — but
 * a row pointing at one is refused anyway, since "has an address" must never be a way to a bot's
 * account.
 */
export async function accountByEmail(
  ctx: Pick<QueryCtx, "db">,
  email: string,
): Promise<{ user: Doc<"users">; address: Doc<"userEmails"> } | null> {
  const rows = await ctx.db.query("userEmails").withIndex("by_email", (q) => q.eq("email", email)).take(2);
  // Two accounts on one address would make "which one is this?" a guess. Refuse to guess.
  if (rows.length > 1) throw new Error("More than one account uses that address. Contact support.");
  const address = rows[0];
  if (!address) return null;
  const user = await ctx.db.get(address.userId);
  if (!user || user.isBot) return null;
  return { user, address };
}

/** A brand-new person's account, opened once their address has been proved with an emailed code. */
export async function createAccountForEmail(
  ctx: Pick<MutationCtx, "db">,
  email: string,
  profile?: { username: string; name: string },
): Promise<Id<"users">> {
  const userId = await ctx.db.insert("users", {
    name: profile?.name ?? displayNameFromEmail(email),
    // A chosen username is checked by the caller; a derived one is bumped until it's free.
    username: profile?.username ?? (await freeUsername(ctx, usernameFromEmail(email))),
  });
  await ctx.db.insert("userEmails", { userId, email, verifiedAt: Date.now(), source: "signup" });
  return userId;
}
