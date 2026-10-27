import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { constantTimeEqual, isValidEmail, normalizeEmail } from "./lib/authPolicy";

/**
 * Moving the accounts that were made under Clerk across to Convex sign-in.
 *
 * Nothing about an account changes except that it gains an address: its id, username, friends,
 * messages, badges and purchases are all untouched, because Convex auth signs in as the same
 * `users` row. What Clerk held and Convex didn't was the address, so this copies it over.
 *
 * Run it once, before the new app version goes out:
 *
 *   npx convex env set CLERK_SECRET_KEY sk_live_…     (the key from Clerk's dashboard)
 *   npx convex run clerkMigration:backfillEmails '{"token":"…","dryRun":true}'   look first
 *   npx convex run clerkMigration:backfillEmails '{"token":"…"}'                  then do it
 *   npx convex run clerkMigration:coverage '{"token":"…"}'                       who is left
 *
 * It is safe to run again: an account that already has an address is left alone, and a Clerk
 * account that never opened this app has no row here and is skipped. Nobody can sign in with a
 * copied address on its own — it is where the "choose a password" emailed code is sent, and the
 * code is what proves it's still theirs.
 */

interface ClerkEmail {
  id: string;
  email_address: string;
  verification?: { status?: string } | null;
}

interface ClerkUser {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: ClerkEmail[];
}

const PAGE = 100;

/** The one address to keep for a Clerk user: their primary one, else the first they've verified. */
export function chooseEmail(user: ClerkUser): { email: string; verified: boolean } | null {
  const verified = (e: ClerkEmail) => e.verification?.status === "verified";
  const primary = user.email_addresses.find((e) => e.id === user.primary_email_address_id);
  const picked = primary ?? user.email_addresses.find(verified) ?? user.email_addresses[0];
  if (!picked) return null;
  const email = normalizeEmail(picked.email_address);
  return isValidEmail(email) ? { email, verified: verified(picked) } : null;
}

function checkMigrationToken(token: string): void {
  const expected = process.env.CLERK_MIGRATION_TOKEN;
  if (!expected || !constantTimeEqual(token, expected)) throw new Error("Not authorized.");
}

export const backfillEmails = action({
  args: { token: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { token, dryRun }) => {
    checkMigrationToken(token);
    const key = process.env.CLERK_SECRET_KEY;
    if (!key) {
      throw new Error("Set CLERK_SECRET_KEY on this deployment first: npx convex env set CLERK_SECRET_KEY sk_live_…");
    }
    const totals = { clerkUsers: 0, stored: 0, alreadyHad: 0, noAccountHere: 0, noEmail: 0, addressTaken: 0 };

    for (let offset = 0; ; offset += PAGE) {
      const response = await fetch(`https://api.clerk.com/v1/users?limit=${PAGE}&offset=${offset}&order_by=created_at`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) throw new Error(`Clerk answered ${response.status} when asked for users at offset ${offset}.`);
      const page = (await response.json()) as ClerkUser[];
      totals.clerkUsers += page.length;

      const rows: { clerkId: string; email: string; verified: boolean }[] = [];
      for (const user of page) {
        const chosen = chooseEmail(user);
        if (chosen) rows.push({ clerkId: user.id, ...chosen });
        else totals.noEmail += 1;
      }
      const result = await ctx.runMutation(internal.clerkMigration.storeEmails, { rows, dryRun: dryRun ?? false });
      totals.stored += result.stored;
      totals.alreadyHad += result.alreadyHad;
      totals.noAccountHere += result.noAccountHere;
      totals.addressTaken += result.addressTaken;

      if (page.length < PAGE) break;
    }
    return { dryRun: dryRun ?? false, ...totals };
  },
});

export const storeEmails = internalMutation({
  args: {
    rows: v.array(v.object({ clerkId: v.string(), email: v.string(), verified: v.boolean() })),
    dryRun: v.boolean(),
  },
  handler: async (ctx, { rows, dryRun }) => {
    const out = { stored: 0, alreadyHad: 0, noAccountHere: 0, addressTaken: 0 };
    for (const row of rows) {
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", row.clerkId)).unique();
      if (!user) {
        out.noAccountHere += 1;
        continue;
      }
      const has = await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
      if (has) {
        out.alreadyHad += 1;
        continue;
      }
      // One address, one account. If two accounts claim it, neither is guessed at: it's left for staff to sort out.
      const taken = await ctx.db.query("userEmails").withIndex("by_email", (q) => q.eq("email", row.email)).first();
      if (taken) {
        out.addressTaken += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.db.insert("userEmails", {
          userId: user._id,
          email: row.email,
          verifiedAt: row.verified ? Date.now() : undefined,
          source: "clerk",
        });
      }
      out.stored += 1;
    }
    return out;
  },
});

/** Who still can't sign in, because no address was copied for them. Counts only. */
export const coverage = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    checkMigrationToken(token);
    let people = 0;
    let withAddress = 0;
    let withPassword = 0;
    for await (const user of ctx.db.query("users")) {
      if (user.isBot || user.clerkId?.startsWith("system:")) continue;
      people += 1;
      if (await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", user._id)).first()) withAddress += 1;
      if (await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", user._id)).first()) withPassword += 1;
    }
    return { people, withAddress, withoutAddress: people - withAddress, withPassword, stillToSetPassword: withAddress - withPassword };
  },
});
