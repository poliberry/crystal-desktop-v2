import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { SlowmodeError, slowmodeWaitMs, isSlowmodeExempt, type SlowmodeScope } from "./slowmodePure";

export { SlowmodeError };

/** When `userId` last sent on this clock in the channel, if ever. */
async function lastSend(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">, scope: SlowmodeScope): Promise<Doc<"channelSlowmode"> | null> {
  return ctx.db
    .query("channelSlowmode")
    .withIndex("by_channel_user_scope", (q) => q.eq("channelId", channelId).eq("userId", userId).eq("scope", scope))
    .unique();
}

/** Milliseconds `userId` still has to wait before sending in the channel (0 for no wait, or an exempt member). */
export async function slowmodeRemaining(ctx: QueryCtx, channel: Doc<"channels">, userId: Id<"users">, scope: SlowmodeScope, perms: number): Promise<number> {
  if (!channel.slowmodeSeconds || isSlowmodeExempt(perms)) return 0;
  const row = await lastSend(ctx, channel._id, userId, scope);
  return slowmodeWaitMs(channel.slowmodeSeconds, row?.lastSentAt, Date.now());
}

/**
 * Refuse a send that comes too soon after the last one, otherwise stamp it. Called from the
 * mutation that is about to write the message, so a refused send writes nothing. Exempt members
 * leave no stamp: there is nothing to wait for if slowmode is later raised on a busy channel they
 * moderate, and one less row to write on every message they send.
 */
export async function enforceSlowmode(ctx: MutationCtx, channel: Doc<"channels">, userId: Id<"users">, scope: SlowmodeScope, perms: number): Promise<void> {
  if (!channel.slowmodeSeconds || isSlowmodeExempt(perms)) return;
  const now = Date.now();
  const row = await lastSend(ctx, channel._id, userId, scope);
  const wait = slowmodeWaitMs(channel.slowmodeSeconds, row?.lastSentAt, now);
  if (wait > 0) throw new SlowmodeError(wait);
  if (row) await ctx.db.patch(row._id, { lastSentAt: now });
  else await ctx.db.insert("channelSlowmode", { channelId: channel._id, userId, scope, lastSentAt: now });
}
