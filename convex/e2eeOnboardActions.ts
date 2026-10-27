"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { unwrapFromEscrow } from "./lib/e2eeEscrow";
import { wrapRoomKey } from "./lib/e2eeCrypto";

/** Server escrow is used only to provision recipient wraps during the disclosed transition. */
export const wrapEscrowedFor = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const candidates = await ctx.runQuery(internal.e2eeOnboard.escrowCandidatesForUser, { userId });
    let wrapped = 0;
    for (const item of candidates) {
      const roomKey = await unwrapFromEscrow(item.escrowWrap);
      const userWrap = await wrapRoomKey(roomKey, item.publicKey);
      const saved = await ctx.runMutation(internal.e2eeOnboard.saveUserWrap, {
        keyId: item.keyId,
        userId,
        wrapped: userWrap,
      });
      if (saved) wrapped++;
    }
    return { wrapped };
  },
});
