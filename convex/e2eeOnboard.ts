import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getChannelPermissions, PERMISSIONS } from "./permissions";

/** A user's device starts catch-up after registering its public identity. */
export const start = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.runQuery(api.e2eeKeys.myIdentity, {});
    if (!identity) throw new Error("Register an encryption identity first.");
    await ctx.runAction(internal.e2eeOnboardActions.wrapEscrowedFor, { userId: identity.userId });
    return { started: true };
  },
});

export const escrowCandidatesForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const identity = await ctx.db.query("e2eeIdentities")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("supersededAt", undefined)).first();
    if (!identity) return [];
    const keys = await ctx.db.query("e2eeKeys").withIndex("by_escrowed", (q) => q.eq("escrowed", true)).take(1000);
    const out = [];
    for (const key of keys) {
      if (key.supersededAt) continue;
      const belongs = key.scope === "conversation"
        ? !!(await ctx.db.query("conversationMembers").withIndex("by_conversation_user", (q) => q.eq("conversationId", key.conversationId!).eq("userId", userId)).first())
        : await (async () => {
            const channel = await ctx.db.get(key.channelId!);
            if (!channel) return false;
            const community = await ctx.db.get(channel.communityId);
            const member = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", userId)).first();
            return !!community && !!member && ((await getChannelPermissions(ctx, community, channel._id, userId) & PERMISSIONS.VIEW_CHANNELS) !== 0);
          })();
      if (!belongs) continue;
      const exists = await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user", (q) => q.eq("keyId", key._id).eq("userId", userId)).first();
      if (exists) continue;
      const escrow = await ctx.db.query("e2eeKeyWraps").withIndex("by_key", (q) => q.eq("keyId", key._id)).filter((q) => q.eq(q.field("kind"), "escrow")).first();
      if (escrow) out.push({ keyId: key._id, escrowWrap: escrow.wrapped, publicKey: identity.publicKey });
    }
    return out;
  },
});

export const saveUserWrap = internalMutation({
  args: { keyId: v.id("e2eeKeys"), userId: v.id("users"), wrapped: v.string() },
  handler: async (ctx, { keyId, userId, wrapped }) => {
    const key = await ctx.db.get(keyId);
    if (!key || !key.escrowed || key.supersededAt) return false;
    const activeIdentity = await ctx.db.query("e2eeIdentities")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("supersededAt", undefined)).first();
    if (!activeIdentity) return false;
    const eligible = key.scope === "conversation"
      ? !!(await ctx.db.query("conversationMembers").withIndex("by_conversation_user", (q) => q.eq("conversationId", key.conversationId!).eq("userId", userId)).first())
      : await (async () => {
          const channel = await ctx.db.get(key.channelId!);
          if (!channel) return false;
          const community = await ctx.db.get(channel.communityId);
          const member = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", userId)).first();
          return !!community && !!member && ((await getChannelPermissions(ctx, community, channel._id, userId) & PERMISSIONS.VIEW_CHANNELS) !== 0);
        })();
    if (!eligible) return false;
    const old = await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user", (q) => q.eq("keyId", keyId).eq("userId", userId)).first();
    if (old) return false;
    await ctx.db.insert("e2eeKeyWraps", { keyId, kind: "user", userId, wrapped, createdAt: Date.now() });
    return true;
  },
});

/** Sweep recipients into the wrap queue, and discard escrow only after complete live coverage. */
export const dropCompletedEscrows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query("e2eeKeys").withIndex("by_escrowed", (q) => q.eq("escrowed", true)).take(1000);
    let dropped = 0;
    for (const key of keys) {
      if (key.supersededAt) continue;
      const users: Id<"users">[] = [];
      const bots: Id<"bots">[] = [];
      if (key.scope === "conversation") {
        for (const member of await ctx.db.query("conversationMembers").withIndex("by_conversation", (q) => q.eq("conversationId", key.conversationId!)).collect()) users.push(member.userId);
      } else {
        const channel = await ctx.db.get(key.channelId!);
        if (!channel) continue;
        const community = await ctx.db.get(channel.communityId);
        for (const member of await ctx.db.query("communityMembers").withIndex("by_community", (q) => q.eq("communityId", channel.communityId)).collect()) {
          if (community && (await getChannelPermissions(ctx, community, channel._id, member.userId) & PERMISSIONS.VIEW_CHANNELS)) users.push(member.userId);
        }
        for (const install of await ctx.db.query("botInstalls").withIndex("by_community", (q) => q.eq("communityId", channel.communityId)).collect()) {
          const bot = await ctx.db.get(install.botId);
          if (!bot || !community || !(install.scopes.includes("messages.read") || (install.permissions & PERMISSIONS.SEND_MESSAGES))) continue;
          if (await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", bot.userId)).first() &&
              (await getChannelPermissions(ctx, community, channel._id, bot.userId) & install.permissions & PERMISSIONS.VIEW_CHANNELS)) bots.push(install.botId);
        }
      }
      let complete = true;
      for (const userId of new Set(users)) {
        const has = await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user", (q) => q.eq("keyId", key._id).eq("userId", userId)).first();
        if (has) continue;
        complete = false;
        const identity = await ctx.db.query("e2eeIdentities").withIndex("by_user_active", (q) => q.eq("userId", userId).eq("supersededAt", undefined)).first();
        if (identity) await requestWrap(ctx, key._id, { userId });
      }
      for (const botId of new Set(bots)) {
        const has = await ctx.db.query("e2eeKeyWraps").withIndex("by_key_bot", (q) => q.eq("keyId", key._id).eq("botId", botId)).first();
        if (has) continue;
        complete = false;
        const bot = await ctx.db.get(botId);
        if (bot?.e2eePublicKey) await requestWrap(ctx, key._id, { botId });
      }
      if (!complete) continue;
      const wraps = await ctx.db.query("e2eeKeyWraps").withIndex("by_key", (q) => q.eq("keyId", key._id)).collect();
      for (const wrap of wraps) if (wrap.kind === "escrow") await ctx.db.delete(wrap._id);
      await ctx.db.patch(key._id, { escrowed: false });
      const state = key.scope === "conversation"
        ? await ctx.db.query("e2eeRoomState").withIndex("by_conversation", (q) => q.eq("conversationId", key.conversationId)).first()
        : await ctx.db.query("e2eeRoomState").withIndex("by_channel", (q) => q.eq("channelId", key.channelId)).first();
      if (state) await ctx.db.patch(state._id, { needsRotation: true, updatedAt: Date.now() });
      else await ctx.db.insert("e2eeRoomState", { scope: key.scope, conversationId: key.conversationId, channelId: key.channelId, needsRotation: true, updatedAt: Date.now() });
      dropped++;
    }
    return { dropped };
  },
});

async function requestWrap(ctx: any, keyId: Id<"e2eeKeys">, recipient: { userId?: Id<"users">; botId?: Id<"bots"> }) {
  const requests = await ctx.db.query("e2eeWrapRequests").withIndex("by_key", (q: any) => q.eq("keyId", keyId)).collect();
  if (requests.some((r: any) => r.userId === recipient.userId && r.botId === recipient.botId)) return;
  await ctx.db.insert("e2eeWrapRequests", { keyId, ...recipient, createdAt: Date.now() });
}
