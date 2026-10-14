import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import { internal } from "./_generated/api";
import { AUTH_ERROR } from "./lib/authPolicy";
import { signInBlock } from "./lib/moderation";

/**
 * Sessions.
 *
 * This is the only place the auth library is configured, and it is used for one thing: turning a
 * ticket into a session, and keeping that session alive. It never sees a password. Everything
 * that decides whether somebody may sign in — the password, the emailed code, the second step,
 * the passkey, and whether the account is banned or suspended — happens first, in
 * convex/authFlow.ts and convex/passkeys.ts, and ends in a single-use ticket that this provider
 * redeems (see `redeemTicket` in convex/authInternal.ts).
 *
 * Deployment setup (once, per deployment): `bun run auth:keys` prints the two values to set,
 * `JWT_PRIVATE_KEY` and `JWKS`. See docs/AUTH.md.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      id: "ticket",
      authorize: async (params, ctx) => {
        if (typeof params.ticket !== "string") throw new ConvexError({ code: AUTH_ERROR.invalidCredentials });
        const userId = await ctx.runMutation(internal.authInternal.redeemTicket, { ticket: params.ticket });
        // No ticket, an expired one, one already used, or an account that was blocked in the meantime.
        if (!userId) throw new ConvexError({ code: AUTH_ERROR.invalidCredentials });
        return { userId };
      },
    }),
  ],
  callbacks: {
    /**
     * The last line of defence, on every route to a session. The tickets are only issued to
     * accounts in good standing and are checked again when redeemed, so this should never fire;
     * it is here so that a bug in either of those can't become a banned person signing in.
     */
    async beforeSessionCreation(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user) throw new ConvexError({ code: AUTH_ERROR.invalidCredentials });
      const block = signInBlock(user as Parameters<typeof signInBlock>[0]);
      if (block) {
        throw new ConvexError({
          code: block.kind === "banned" ? AUTH_ERROR.banned : AUTH_ERROR.suspended,
          reason: block.reason,
          ...(block.kind === "suspended" ? { until: block.until, indefinite: block.indefinite } : {}),
        });
      }
    },
  },
});
