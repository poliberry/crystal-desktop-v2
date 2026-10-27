import { v } from "convex/values";
import { getCurrentUserOrThrow } from "./users";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { escrowPublicKey } from "./lib/e2eeEscrow";
import { getChannelPermissions, PERMISSIONS } from "./permissions";

const room = { scope: v.union(v.literal("conversation"), v.literal("channel")), conversationId: v.optional(v.id("conversations")), channelId: v.optional(v.id("channels")) };
async function recipients(ctx: any, scope: "conversation"|"channel", conversationId?: Id<"conversations">, channelId?: Id<"channels">) {
  if (scope === "conversation") {
    const ms = await ctx.db.query("conversationMembers").withIndex("by_conversation", (q: any) => q.eq("conversationId", conversationId)).collect();
    return Promise.all(ms.map(async (m: any) => ({ userId: m.userId, publicKey: (await ctx.db.query("e2eeIdentities").withIndex("by_user_active", (q: any) => q.eq("userId", m.userId).eq("supersededAt", undefined)).first())?.publicKey ?? null })));
  }
  const ch = await ctx.db.get(channelId!); if (!ch) throw new Error("Channel not found.");
  const community = await ctx.db.get(ch.communityId); if (!community) throw new Error("Community not found.");
  const ms = await ctx.db.query("communityMembers").withIndex("by_community", (q: any) => q.eq("communityId", ch.communityId)).collect();
  const users = [];
  for (const m of ms) {
    if (!(await getChannelPermissions(ctx, community, ch._id, m.userId) & PERMISSIONS.VIEW_CHANNELS)) continue;
    const identity = await ctx.db.query("e2eeIdentities").withIndex("by_user_active", (q: any) => q.eq("userId", m.userId).eq("supersededAt", undefined)).first();
    users.push({ userId: m.userId, publicKey: identity?.publicKey ?? null });
  }
  const bots = [];
  for (const install of await ctx.db.query("botInstalls").withIndex("by_community", (q: any) => q.eq("communityId", ch.communityId)).collect()) {
    const bot = await ctx.db.get(install.botId);
    if (!bot?.e2eePublicKey || !community || !(install.scopes.includes("messages.read") || (install.permissions & PERMISSIONS.SEND_MESSAGES))) continue;
    const botMember = await ctx.db.query("communityMembers").withIndex("by_community_user", (q: any) => q.eq("communityId", ch.communityId).eq("userId", bot.userId)).first();
    if (!botMember) continue;
    const permissions = await getChannelPermissions(ctx, community, ch._id, bot.userId);
    if (!(permissions & install.permissions & PERMISSIONS.VIEW_CHANNELS)) continue;
    bots.push({ botId: install.botId, publicKey: bot.e2eePublicKey });
  }
  return [...users, ...bots];
}
export const registerIdentity = mutation({ args: { publicKey:v.string(), fingerprint:v.string(), backup:v.object({salt:v.string(),iv:v.string(),ct:v.string()}) }, handler: async(ctx,args)=>{ const me=await getCurrentUserOrThrow(ctx); const old=await ctx.db.query("e2eeIdentities").withIndex("by_user_active",q=>q.eq("userId",me._id).eq("supersededAt",undefined)).first(); if(old) throw new Error("Encryption identity already exists."); await ctx.db.insert("e2eeIdentities",{userId:me._id,...args,createdAt:Date.now()}); await ctx.scheduler.runAfter(0, internal.e2eeOnboardActions.wrapEscrowedFor, { userId: me._id }); }});
export const rotateIdentity = mutation({ args: { publicKey:v.string(), fingerprint:v.string(), backup:v.object({salt:v.string(),iv:v.string(),ct:v.string()}) }, handler: async(ctx,args)=>{ const me=await getCurrentUserOrThrow(ctx); const now=Date.now(); const old=await ctx.db.query("e2eeIdentities").withIndex("by_user_active",q=>q.eq("userId",me._id).eq("supersededAt",undefined)).first(); if(old) await ctx.db.patch(old._id,{supersededAt:now}); await ctx.db.insert("e2eeIdentities",{userId:me._id,...args,createdAt:now}); }});
export const myIdentity = query({args:{},handler:async(ctx)=>{const me=await getCurrentUserOrThrow(ctx); return await ctx.db.query("e2eeIdentities").withIndex("by_user_active",q=>q.eq("userId",me._id).eq("supersededAt",undefined)).first();}});
export const getBackup = query({args:{},handler:async(ctx)=>{const me=await getCurrentUserOrThrow(ctx); return (await ctx.db.query("e2eeIdentities").withIndex("by_user_active",q=>q.eq("userId",me._id).eq("supersededAt",undefined)).first())?.backup ?? null;}});
export const escrowPublic = query({args:{},handler:async()=>escrowPublicKey()});
export const publicKeys = query({args:{userIds:v.array(v.id("users"))},handler:async(ctx,{userIds})=>Promise.all(userIds.map(async userId=>{const i=await ctx.db.query("e2eeIdentities").withIndex("by_user_active",q=>q.eq("userId",userId).eq("supersededAt",undefined)).first(); return {userId,publicKey:i?.publicKey??null,fingerprint:i?.fingerprint??null};}))});
export const current = query({args:room,handler:async(ctx,{scope,conversationId,channelId})=>{const me=await getCurrentUserOrThrow(ctx); const rows=scope==="conversation"?await ctx.db.query("e2eeKeys").withIndex("by_conversation",q=>q.eq("conversationId",conversationId)).collect():await ctx.db.query("e2eeKeys").withIndex("by_channel",q=>q.eq("channelId",channelId)).collect(); const key=rows.filter(k=>!k.supersededAt).sort((a,b)=>b.epoch-a.epoch)[0]; if(!key)return null; const wrap=await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user",q=>q.eq("keyId",key._id).eq("userId",me._id)).first(); const state=scope==="conversation"?await ctx.db.query("e2eeRoomState").withIndex("by_conversation",q=>q.eq("conversationId",conversationId)).first():await ctx.db.query("e2eeRoomState").withIndex("by_channel",q=>q.eq("channelId",channelId)).first(); return {keyId:key._id,epoch:key.epoch,escrowed:key.escrowed,needsRotation:state?.needsRotation??false,myWrap:wrap?.wrapped??null};}});
export const wrapsForMe = query({args:{keyIds:v.array(v.id("e2eeKeys"))},handler:async(ctx,{keyIds})=>{const me=await getCurrentUserOrThrow(ctx); const out:Record<string,string>={}; for(const keyId of keyIds){const w=await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user",q=>q.eq("keyId",keyId).eq("userId",me._id)).first();if(w)out[keyId]=w.wrapped;}return out;}});
export const recipientsForRoom = query({args:room,handler:async(ctx,{scope,conversationId,channelId})=>{const me=await getCurrentUserOrThrow(ctx); const rows=await recipients(ctx,scope,conversationId,channelId);if(!rows.some(r=>r.userId===me._id))throw new Error("Not a room member.");return rows;}});
export { recipientsForRoom as recipients };
export const createEpoch = mutation({args:{...room,wraps:v.array(v.object({userId:v.optional(v.id("users")),botId:v.optional(v.id("bots")),wrapped:v.string()})),escrowWrap:v.optional(v.string())},handler:async(ctx,{scope,conversationId,channelId,wraps,escrowWrap})=>{const me=await getCurrentUserOrThrow(ctx);const rs=await recipients(ctx,scope,conversationId,channelId);if(!rs.some(r=>r.userId===me._id))throw new Error("Not a room member.");const allowedUsers=new Set(rs.map((r:any)=>r.userId).filter(Boolean));const allowedBots=new Set(rs.map((r:any)=>r.botId).filter(Boolean));for(const w of wraps){if((w.userId&&!allowedUsers.has(w.userId))||(w.botId&&!allowedBots.has(w.botId))||(!w.userId&&!w.botId))throw new Error("Epoch wrap recipient is not eligible for this room.");}const keys=scope==="conversation"?await ctx.db.query("e2eeKeys").withIndex("by_conversation",q=>q.eq("conversationId",conversationId)).collect():await ctx.db.query("e2eeKeys").withIndex("by_channel",q=>q.eq("channelId",channelId)).collect();const active=keys.filter(k=>!k.supersededAt);const state=scope==="conversation"?await ctx.db.query("e2eeRoomState").withIndex("by_conversation",q=>q.eq("conversationId",conversationId)).first():await ctx.db.query("e2eeRoomState").withIndex("by_channel",q=>q.eq("channelId",channelId)).first();if(active.length&&!state?.needsRotation)throw new Error("Room already has a current epoch.");const id=await ctx.db.insert("e2eeKeys",{scope,conversationId,channelId,epoch:Math.max(0,...keys.map(k=>k.epoch))+1,origin:"client",escrowed:!!escrowWrap,createdAt:Date.now(),createdBy:me._id});for(const w of wraps){if(w.userId)await ctx.db.insert("e2eeKeyWraps",{keyId:id,kind:"user",userId:w.userId,wrapped:w.wrapped,createdAt:Date.now()});else if(w.botId)await ctx.db.insert("e2eeKeyWraps",{keyId:id,kind:"bot",botId:w.botId,wrapped:w.wrapped,createdAt:Date.now()});}if(escrowWrap)await ctx.db.insert("e2eeKeyWraps",{keyId:id,kind:"escrow",wrapped:escrowWrap,createdAt:Date.now()});if(state)await ctx.db.patch(state._id,{needsRotation:false,updatedAt:Date.now()});else await ctx.db.insert("e2eeRoomState",{scope,conversationId,channelId,needsRotation:false,updatedAt:Date.now()});return {keyId:id,escrowed:!!escrowWrap};}});
export const pendingWrapRequests = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    await getCurrentUserOrThrow(ctx);
    const rows = await ctx.db.query("e2eeWrapRequests").withIndex("by_created").take(Math.min(limit, 100));
    return Promise.all(rows.map(async (row) => ({
      ...row,
      publicKey: row.userId
        ? (await ctx.db.query("e2eeIdentities").withIndex("by_user_active", (q) => q.eq("userId", row.userId!).eq("supersededAt", undefined)).first())?.publicKey ?? null
        : row.botId
          ? (await ctx.db.get(row.botId))?.e2eePublicKey ?? null
          : null,
    })));
  },
});

/** Ask current key holders to wrap existing channel epochs to a newly registered bot key. */
export const queueBotWraps = internalMutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }) => {
    const bot = await ctx.db.get(botId);
    if (!bot?.e2eePublicKey) return 0;
    let queued = 0;
    for (const install of await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", botId)).collect()) {
      if (!(install.scopes.includes("messages.read") || (install.permissions & PERMISSIONS.SEND_MESSAGES))) continue;
      const community = await ctx.db.get(install.communityId);
      const member = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", install.communityId).eq("userId", bot.userId)).first();
      if (!community || !member) continue;
      const channels = await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", install.communityId)).collect();
      for (const channel of channels) {
        if (!(await getChannelPermissions(ctx, community, channel._id, bot.userId) & install.permissions & PERMISSIONS.VIEW_CHANNELS)) continue;
        const keys = await ctx.db.query("e2eeKeys").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect();
        for (const key of keys) {
          if (key.supersededAt) continue;
          if (await ctx.db.query("e2eeKeyWraps").withIndex("by_key_bot", (q) => q.eq("keyId", key._id).eq("botId", botId)).first()) continue;
          const requests = await ctx.db.query("e2eeWrapRequests").withIndex("by_key", (q) => q.eq("keyId", key._id)).collect();
          if (requests.some((request) => request.botId === botId)) continue;
          await ctx.db.insert("e2eeWrapRequests", { keyId: key._id, botId, createdAt: Date.now() });
          queued++;
        }
      }
    }
    return queued;
  },
});

export const fulfilWrapRequests = mutation({args:{items:v.array(v.object({requestId:v.id("e2eeWrapRequests"),wrapped:v.string()}))},handler:async(ctx,{items})=>{const me=await getCurrentUserOrThrow(ctx);for(const i of items){const r=await ctx.db.get(i.requestId);if(!r)continue;const key=await ctx.db.get(r.keyId);if(!key||key.supersededAt) { await ctx.db.delete(r._id); continue; }const held=await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user",q=>q.eq("keyId",r.keyId).eq("userId",me._id)).first();if(!held)continue;const callerEligible=key.scope==="conversation"?!!(await ctx.db.query("conversationMembers").withIndex("by_conversation_user",q=>q.eq("conversationId",key.conversationId!).eq("userId",me._id)).first()):await (async()=>{const ch=await ctx.db.get(key.channelId!);if(!ch)return false;const community=await ctx.db.get(ch.communityId);return !!community&&!!(await ctx.db.query("communityMembers").withIndex("by_community_user",q=>q.eq("communityId",ch.communityId).eq("userId",me._id)).first())&&!!(await getChannelPermissions(ctx,community,ch._id,me._id)&PERMISSIONS.VIEW_CHANNELS);})();if(!callerEligible)continue;let eligible=false;if(r.userId){eligible=key.scope==="conversation"?!!(await ctx.db.query("conversationMembers").withIndex("by_conversation_user",q=>q.eq("conversationId",key.conversationId!).eq("userId",r.userId!)).first()):await (async()=>{const ch=await ctx.db.get(key.channelId!);if(!ch)return false;const community=await ctx.db.get(ch.communityId);return !!community&&!!(await ctx.db.query("communityMembers").withIndex("by_community_user",q=>q.eq("communityId",ch.communityId).eq("userId",r.userId!)).first())&&!!(await getChannelPermissions(ctx,community,ch._id,r.userId!)&PERMISSIONS.VIEW_CHANNELS);})();}else if(r.botId){const bot=await ctx.db.get(r.botId);eligible=!!bot?.e2eePublicKey;}if(!eligible)continue;const existing=r.userId?await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user",q=>q.eq("keyId",r.keyId).eq("userId",r.userId)).first():await ctx.db.query("e2eeKeyWraps").withIndex("by_key_bot",q=>q.eq("keyId",r.keyId).eq("botId",r.botId)).first();if(!existing){await ctx.db.insert("e2eeKeyWraps",{keyId:r.keyId,kind:r.userId?"user":"bot",userId:r.userId,botId:r.botId,wrapped:i.wrapped,createdAt:Date.now()});await ctx.db.delete(r._id);}}}});
