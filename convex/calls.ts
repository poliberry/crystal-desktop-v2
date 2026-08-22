import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

export const listParticipants = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("callParticipants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    const participants = await Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        if (!user) return null;
        return { id: user._id, name: user.name, username: user.username, imageUrl: user.imageUrl };
      })
    );
    return participants.filter((p): p is NonNullable<typeof p> => p !== null);
  },
});

/**
 * Removes the caller's participant row and reports how many participants are
 * left, so the calling action (callTokens.ts's `leave`) knows whether to
 * close the underlying LiveKit room. A plain mutation can't reach LiveKit's
 * REST API itself (no outbound network access), hence the split.
 */
export const recordLeave = internalMutation({
  args: { conversationId: v.id("conversations"), userId: v.id("users") },
  handler: async (ctx, { conversationId, userId }) => {
    const row = await ctx.db
      .query("callParticipants")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", userId)
      )
      .unique();
    if (row) await ctx.db.delete(row._id);

    const remaining = await ctx.db
      .query("callParticipants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    return remaining.length;
  },
});

/** Used by the `"use node"` token-minting action in callTokens.ts, which can't touch ctx.db directly. */
export const recordJoin = internalMutation({
  args: { conversationId: v.id("conversations"), userId: v.id("users") },
  handler: async (ctx, { conversationId, userId }) => {
    const existing = await ctx.db
      .query("callParticipants")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", userId)
      )
      .unique();
    if (existing) return;
    await ctx.db.insert("callParticipants", { conversationId, userId, joinedAt: Date.now() });
  },
});

/** Every DM call participant row, for the LiveKit reconciliation sweep
 * (convex/lib/callReconciliation.ts) — cross-checked against who's actually
 * still connected, since a refresh/crash never runs the explicit `leave`
 * action. */
export const listAllParticipants = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("callParticipants").collect(),
});

export const getJoinContext = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("Not a member of this conversation.");
    return { userId: me._id, name: me.name };
  },
});

// --- Ringing ---------------------------------------------------------------
// Starting a DM or group call rings everyone else in the conversation. A
// `callRings` row *is* the ringing state, so answering, declining and
// expiring all reduce to deleting it — and the recipient's query is a single
// index lookup with no status filtering.

/** How long a ring goes unanswered before it counts as missed. */
const RING_TIMEOUT_MS = 45_000;

/** Delete a ring row and cancel its pending expiry sweep. */
async function clearRing(ctx: MutationCtx, ring: Doc<"callRings">): Promise<void> {
  if (ring.expiryJobId) await ctx.scheduler.cancel(ring.expiryJobId).catch(() => {});
  await ctx.db.delete(ring._id);
}

/** Every ring the caller is currently being called by. */
export const listIncomingRings = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];

    const rings = await ctx.db
      .query("callRings")
      .withIndex("by_recipient", (q) => q.eq("recipientId", me._id))
      .collect();

    const resolved = await Promise.all(
      rings.map(async (ring) => {
        const [caller, conversation] = await Promise.all([
          ctx.db.get(ring.callerId),
          ctx.db.get(ring.conversationId),
        ]);
        if (!caller || !conversation) return null;

        // Group calls are named for the conversation; a DM is named for the
        // person calling, since "Direct message" tells you nothing.
        const isGroup = conversation.type === "group";
        return {
          id: ring._id,
          conversationId: ring.conversationId,
          callerId: caller._id,
          callerName: caller.name,
          callerImageUrl: caller.imageUrl,
          title: isGroup ? (conversation.name ?? "Group call") : caller.name,
          isGroup,
          createdAt: ring.createdAt,
        };
      })
    );
    return resolved.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/**
 * Ring everyone else in a conversation. Skips anyone already in the call and
 * anyone already being rung, so re-joining a call doesn't re-ring the room.
 */
export const ring = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);

    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("You're not in this conversation.");

    const [members, inCall] = await Promise.all([
      ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
        .collect(),
      ctx.db
        .query("callParticipants")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
        .collect(),
    ]);
    const alreadyInCall = new Set(inCall.map((p) => p.userId));

    for (const member of members) {
      if (member.userId === me._id || alreadyInCall.has(member.userId)) continue;

      const existing = await ctx.db
        .query("callRings")
        .withIndex("by_conversation_recipient", (q) =>
          q.eq("conversationId", conversationId).eq("recipientId", member.userId)
        )
        .unique();
      if (existing) continue;

      const ringId = await ctx.db.insert("callRings", {
        conversationId,
        callerId: me._id,
        recipientId: member.userId,
        createdAt: Date.now(),
      });
      const expiryJobId = await ctx.scheduler.runAfter(
        RING_TIMEOUT_MS,
        internal.calls.expireRing,
        { ringId }
      );
      await ctx.db.patch(ringId, { expiryJobId });
    }
  },
});

/** Stop ringing the caller for this conversation — used when they decline,
 * and when they answer (the join path clears it too). */
export const dismissRing = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const ring = await ctx.db
      .query("callRings")
      .withIndex("by_conversation_recipient", (q) =>
        q.eq("conversationId", conversationId).eq("recipientId", me._id)
      )
      .unique();
    if (ring) await clearRing(ctx, ring);
  },
});

/**
 * Stop every ring for a conversation. Called when the last participant leaves
 * so an abandoned call doesn't keep ringing phones.
 */
export const cancelRings = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    await getCurrentUserOrThrow(ctx);
    const rings = await ctx.db
      .query("callRings")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    for (const ring of rings) await clearRing(ctx, ring);
  },
});

/** Scheduled per ring: an unanswered ring becomes a missed call. */
export const expireRing = internalMutation({
  args: { ringId: v.id("callRings") },
  handler: async (ctx, { ringId }) => {
    const ring = await ctx.db.get(ringId);
    if (!ring) return;
    // The sweep is what fired, so there's no job left to cancel.
    await ctx.db.delete(ring._id);
  },
});

/** Clear a user's ring for a conversation once they're actually in the call.
 * Used by the join path, which runs as an action and can't touch the db. */
export const clearRingForJoin = internalMutation({
  args: { conversationId: v.id("conversations"), userId: v.id("users") },
  handler: async (ctx, { conversationId, userId }) => {
    const ring = await ctx.db
      .query("callRings")
      .withIndex("by_conversation_recipient", (q) =>
        q.eq("conversationId", conversationId).eq("recipientId", userId)
      )
      .unique();
    if (ring) await clearRing(ctx, ring);
  },
});

/** Which members of a conversation are currently being rung — drives the
 * "Ringing…" state on the call screen's placeholder tiles. */
export const listRingsForConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rings = await ctx.db
      .query("callRings")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    return rings.map((ring) => ring.recipientId);
  },
});
