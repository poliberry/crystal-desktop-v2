import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { loadMemberVoiceAccess } from "./lib/voiceAccess";
import { resolveVoiceGrant, voiceGrantKey, type VoiceGrant } from "./lib/voiceGrant";
import { removeVoiceRow } from "./lib/voiceState";

/**
 * The database half of keeping a connected person's LiveKit grant in step with their permissions
 * (the LiveKit half is voiceSync.ts, which has to run in Node).
 */

export interface GrantCheck {
  channelId: Id<"channels">;
  userId: Id<"users">;
  rowId: Id<"channelCallParticipants">;
  /** False when they may no longer be in the channel at all (lost Connect, timed out, left the community). */
  allowed: boolean;
  grant: VoiceGrant;
  grantKey: string;
}

/**
 * Who in a channel (or every channel of a community, or one person) has a grant that no longer matches
 * what their permissions say. People whose grant is already right are left out, so LiveKit is only asked
 * about the ones that changed.
 */
export const staleGrants = internalQuery({
  args: {
    communityId: v.optional(v.id("communities")),
    channelId: v.optional(v.id("channels")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, { communityId, channelId, userId }): Promise<GrantCheck[]> => {
    let rows = channelId
      ? await ctx.db.query("channelCallParticipants").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect()
      : userId
        ? await ctx.db.query("channelCallParticipants").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
        : await ctx.db.query("channelCallParticipants").collect();
    if (userId) rows = rows.filter((r) => r.userId === userId);

    const channels = new Map<string, Doc<"channels"> | null>();
    const communities = new Map<string, Doc<"communities"> | null>();
    const out: GrantCheck[] = [];
    for (const row of rows) {
      let channel = channels.get(row.channelId);
      if (channel === undefined) {
        channel = await ctx.db.get(row.channelId);
        channels.set(row.channelId, channel);
      }
      if (!channel || (communityId && channel.communityId !== communityId)) continue;
      let community = communities.get(channel.communityId);
      if (community === undefined) {
        community = await ctx.db.get(channel.communityId);
        communities.set(channel.communityId, community);
      }
      if (!community) continue;

      const access = await loadMemberVoiceAccess(ctx, community, channel, row.userId, row);
      // A bot's token never carried video, and a permission change must not hand it any.
      const user = await ctx.db.get(row.userId);
      const grant = user?.isBot ? resolveVoiceGrant({ ...access.input, canVideo: false }) : access.grant;
      const grantKey = voiceGrantKey(grant);
      if (access.allowed && row.grantKey === grantKey && (row.stageSpeaker ?? false) === grant.stageSpeaker) continue;
      out.push({ channelId: row.channelId, userId: row.userId, rowId: row._id, allowed: access.allowed, grant, grantKey });
    }
    return out;
  },
});

/** Record what LiveKit was told, and drop the rows of anyone who was removed. */
export const recordGrants = internalMutation({
  args: {
    applied: v.array(v.object({ rowId: v.id("channelCallParticipants"), grantKey: v.string(), stageSpeaker: v.boolean() })),
    removed: v.array(v.id("channelCallParticipants")),
  },
  handler: async (ctx, { applied, removed }) => {
    for (const a of applied) {
      const row = await ctx.db.get(a.rowId);
      if (!row) continue;
      await ctx.db.patch(row._id, {
        grantKey: a.grantKey,
        stageSpeaker: a.stageSpeaker,
        // Someone brought up to speak, or sent back down, has no hand raised any more.
        ...(a.stageSpeaker !== (row.stageSpeaker ?? false) ? { handRaisedAt: undefined } : {}),
        // A speaker who stopped being one by losing permission has lost the approval too.
        ...(!a.stageSpeaker && row.stageApproved ? { stageApproved: undefined } : {}),
      });
    }
    for (const id of removed) {
      const row = await ctx.db.get(id);
      if (row) await removeVoiceRow(ctx, row, { evict: false });
    }
  },
});
