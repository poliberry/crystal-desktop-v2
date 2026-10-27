import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { api, internal } from "./_generated/api";
import { requireStaff } from "./lib/staff";
import { getCurrentUserOrThrow } from "./users";
import { encryptMessage } from "./lib/e2eeCrypto";
import { newEscrowedRoomKey } from "./lib/e2eeEscrow";
import type { Id } from "./_generated/dataModel";

export const authorize = query({ args: {}, handler: async (ctx) => { await requireStaff(ctx, "system.manage"); return true; } });

export const preview = internalQuery({args:{scope:v.union(v.literal("conversation"),v.literal("channel")),targetId:v.string(),limit:v.number()},handler:async(ctx,{scope,targetId,limit})=>{const rows=scope==="conversation"?await ctx.db.query("messages").withIndex("by_conversation",q=>q.eq("conversationId",targetId as Id<"conversations">)).take(Math.min(limit,200)):await ctx.db.query("channelMessages").withIndex("by_channel",q=>q.eq("channelId",targetId as Id<"channels">)).take(Math.min(limit,200));return rows.filter(r=>!r.enc&&r.text!==undefined);}});
export const prepare = internalMutation({args:{scope:v.union(v.literal("conversation"),v.literal("channel")),targetId:v.string(),escrowWrap:v.string()},handler:async(ctx,a)=>{const rows=a.scope==="conversation"?await ctx.db.query("e2eeKeys").withIndex("by_conversation",q=>q.eq("conversationId",a.targetId as Id<"conversations">)).collect():await ctx.db.query("e2eeKeys").withIndex("by_channel",q=>q.eq("channelId",a.targetId as Id<"channels">)).collect();const keyId=await ctx.db.insert("e2eeKeys",{scope:a.scope,conversationId:a.scope==="conversation"?a.targetId as Id<"conversations">:undefined,channelId:a.scope==="channel"?a.targetId as Id<"channels">:undefined,epoch:Math.max(0,...rows.map(k=>k.epoch))+1,origin:"migration",escrowed:true,createdAt:Date.now()});await ctx.db.insert("e2eeKeyWraps",{keyId,kind:"escrow",wrapped:a.escrowWrap,createdAt:Date.now()});return keyId;}});
export const save = internalMutation({args:{scope:v.union(v.literal("conversation"),v.literal("channel")),keyId:v.id("e2eeKeys"),rows:v.array(v.object({id:v.string(),authorId:v.id("users"),iv:v.string(),ct:v.string()}))},handler:async(ctx,a)=>{let saved=0;for(const r of a.rows){if(a.scope==="conversation"){const id=r.id as Id<"messages">;const old=await ctx.db.get(id);if(!old||old.enc||old.text===undefined)continue;await ctx.db.patch(id,{enc:{keyId:a.keyId,iv:r.iv,ct:r.ct},text:undefined});}else{const id=r.id as Id<"channelMessages">;const old=await ctx.db.get(id);if(!old||old.enc||old.text===undefined)continue;await ctx.db.patch(id,{enc:{keyId:a.keyId,iv:r.iv,ct:r.ct},text:undefined,embeds:undefined,components:undefined});}saved++;}return saved;}});
export const run: any = action({args:{scope:v.union(v.literal("conversation"),v.literal("channel")),targetId:v.string(),batchSize:v.optional(v.number()),dryRun:v.optional(v.boolean())},handler:async(ctx,{scope,targetId,batchSize=100,dryRun=true})=>{await ctx.runQuery((api as any).e2eeMigrate.authorize,{});const size=Math.min(batchSize,200);const rows: any=await ctx.runQuery((internal as any).e2eeMigrate.preview,{scope,targetId,limit:size});if(dryRun)return {dryRun:true,eligible:rows.length,hasMore:rows.length===size};if(!rows.length)return {dryRun:false,migrated:0,done:true};const made=await newEscrowedRoomKey();const keyId: Id<"e2eeKeys">=await ctx.runMutation((internal as any).e2eeMigrate.prepare,{scope,targetId,escrowWrap:made.escrowWrap});const result=[];for(const row of rows){const payload={text:row.text,...("embeds" in row&&row.embeds?{embeds:row.embeds}:{}),...( "components" in row&&row.components?{components:row.components}:{})};const enc=await encryptMessage(made.roomKey,payload,{scope,targetId,keyId,authorId:row.authorId});result.push({id:row._id,authorId:row.authorId,iv:enc.iv,ct:enc.ct});}await ctx.runMutation((internal as any).e2eeMigrate.save,{scope,keyId,rows:result});return {dryRun:false,migrated:result.length,keyId,done:result.length<size};}});

/** Start a resumable whole-database backfill. Each scheduled invocation handles one page only. */
export const startAll: any = action({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize = 100 }) => {
    // The backfill replaces every stored message body, so it is the one console action here that asks for a code.
    await ctx.runQuery((internal as any).staff.requireForAction, { permissions: ["system.manage"], destructive: true });
    const jobId: Id<"e2eeMigrationJobs"> = await ctx.runMutation((internal as any).e2eeMigrate.createJob, { batchSize: Math.max(1, Math.min(batchSize, 200)) });
    await ctx.scheduler.runAfter(0, (internal as any).e2eeMigrate.processBatch, { jobId });
    return { jobId, status: "running" as const };
  },
});

export const createJob = internalMutation({
  args: { batchSize: v.number() },
  handler: async (ctx, { batchSize }) => {
    const running = await ctx.db.query("e2eeMigrationJobs").withIndex("by_status", q => q.eq("status", "running")).first();
    if (running) throw new Error("An all-rooms E2EE migration is already running.");
    // The public action has already checked staff assurance. Resolve the user from the session
    // the same way every other function does (the identity subject is `userId|sessionId` under
    // Convex Auth, not a Clerk id, so it can't be looked up by `clerkId`).
    const dbUser = await getCurrentUserOrThrow(ctx);
    return ctx.db.insert("e2eeMigrationJobs", { status: "running", phase: "conversation", batchSize, roomScanDone: false, migrated: 0, skipped: 0, batches: 0, startedAt: Date.now(), updatedAt: Date.now(), startedBy: dbUser._id });
  },
});

export const status = query({
  args: { jobId: v.id("e2eeMigrationJobs") },
  handler: async (ctx, { jobId }) => { await requireStaff(ctx, "system.manage"); return await ctx.db.get(jobId); },
});

/** Most recent migration, for the staff console to resume or monitor it. */
export const latest = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "system.manage");
    return await ctx.db.query("e2eeMigrationJobs").order("desc").first();
  },
});

export const cancel: any = action({
  args: { jobId: v.id("e2eeMigrationJobs") },
  handler: async (ctx, { jobId }) => { await ctx.runQuery((api as any).e2eeMigrate.authorize, {}); return await ctx.runMutation((internal as any).e2eeMigrate.cancelJob, { jobId }); },
});

/** Retry a failed job from its last committed page cursor. */
export const retry = action({
  args: { jobId: v.id("e2eeMigrationJobs") },
  handler: async (ctx, { jobId }) => { await ctx.runQuery((api as any).e2eeMigrate.authorize, {}); await ctx.runMutation((internal as any).e2eeMigrate.retryJob, { jobId }); await ctx.scheduler.runAfter(0, (internal as any).e2eeMigrate.processBatch, { jobId }); return { status: "running" as const }; },
});
export const retryJob = internalMutation({
  args: { jobId: v.id("e2eeMigrationJobs") },
  handler: async (ctx, { jobId }) => { const job = await ctx.db.get(jobId); if (!job || job.status !== "failed") throw new Error("Only a failed job can be retried."); const running = await ctx.db.query("e2eeMigrationJobs").withIndex("by_status", q => q.eq("status", "running")).first(); if (running) throw new Error("Another all-rooms migration is already running."); await ctx.db.patch(jobId, { status: "running", error: undefined, finishedAt: undefined, updatedAt: Date.now() }); },
});

export const cancelJob = internalMutation({
  args: { jobId: v.id("e2eeMigrationJobs") },
  handler: async (ctx, { jobId }) => { const job = await ctx.db.get(jobId); if (!job || job.status !== "running") return job?.status ?? "missing"; await ctx.db.patch(jobId, { status: "cancelled", updatedAt: Date.now(), finishedAt: Date.now() }); return "cancelled"; },
});

export const getJob = internalQuery({ args: { jobId: v.id("e2eeMigrationJobs") }, handler: (ctx, { jobId }) => ctx.db.get(jobId) });

export const nextRoom = internalQuery({
  args: { scope: v.union(v.literal("conversation"), v.literal("channel")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { scope, paginationOpts }) => scope === "conversation"
    ? await ctx.db.query("conversations").order("asc").paginate(paginationOpts)
    : await ctx.db.query("channels").order("asc").paginate(paginationOpts),
});

export const processBatch = internalAction({
  args: { jobId: v.id("e2eeMigrationJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery((internal as any).e2eeMigrate.getJob, { jobId });
    if (!job || job.status !== "running") return;
    try {
      let phase = job.phase;
      let roomCursor = job.roomCursor ?? null;
      let messageCursor = job.messageCursor ?? null;
      let targetId = job.activeTargetId;
      if (!targetId) {
        if (phase === "done") { await ctx.runMutation((internal as any).e2eeMigrate.finishJob, { jobId }); return; }
        if (job.roomScanDone) {
          phase = phase === "conversation" ? "channel" : "done";
          roomCursor = null;
          await ctx.runMutation((internal as any).e2eeMigrate.advanceJob, { jobId, phase, roomCursor, roomScanDone: false, targetId: undefined, messageCursor: null, migrated: 0, skipped: 0 });
          await ctx.scheduler.runAfter(0, (internal as any).e2eeMigrate.processBatch, { jobId }); return;
        }
        const rooms = await ctx.runQuery((internal as any).e2eeMigrate.nextRoom, { scope: phase, paginationOpts: { numItems: 1, cursor: roomCursor } });
        if (!rooms.page.length) {
          phase = phase === "conversation" ? "channel" : "done";
          roomCursor = null;
          await ctx.runMutation((internal as any).e2eeMigrate.advanceJob, { jobId, phase, roomCursor, roomScanDone: false, targetId: undefined, messageCursor: null, migrated: 0, skipped: 0 });
          await ctx.scheduler.runAfter(0, (internal as any).e2eeMigrate.processBatch, { jobId }); return;
        }
        targetId = rooms.page[0]._id;
        roomCursor = rooms.continueCursor;
        await ctx.runMutation((internal as any).e2eeMigrate.advanceJob, { jobId, phase, roomCursor, roomScanDone: rooms.isDone, targetId, messageCursor: null, migrated: 0, skipped: 0 });
      }
      if (phase === "done") { await ctx.runMutation((internal as any).e2eeMigrate.finishJob, { jobId }); return; }
      const scope: "conversation" | "channel" = phase;
      const rows: any = await ctx.runQuery((internal as any).e2eeMigrate.previewPage, { scope, targetId, paginationOpts: { numItems: job.batchSize, cursor: messageCursor } });
      const eligible = rows.page.filter((r: any) => !r.system && !r.enc && r.text !== undefined);
      let migrated = 0;
      if (eligible.length) {
        const made = await newEscrowedRoomKey();
        const keyId = await ctx.runMutation((internal as any).e2eeMigrate.prepare, { scope, targetId, escrowWrap: made.escrowWrap });
        const encrypted = [];
        for (const row of eligible) {
          const payload = { text: row.text, ...(row.embeds ? { embeds: row.embeds } : {}), ...(row.components ? { components: row.components } : {}) };
          const enc = await encryptMessage(made.roomKey, payload, { scope, targetId, keyId, authorId: row.authorId });
          encrypted.push({ id: row._id, authorId: row.authorId, iv: enc.iv, ct: enc.ct });
        }
        migrated = await ctx.runMutation((internal as any).e2eeMigrate.save, { scope, keyId, rows: encrypted });
      }
      const doneRoom = rows.isDone;
      await ctx.runMutation((internal as any).e2eeMigrate.advanceJob, { jobId, phase, roomCursor, roomScanDone: job.roomScanDone, targetId: doneRoom ? undefined : targetId, messageCursor: doneRoom ? null : rows.continueCursor, migrated, skipped: rows.page.length - eligible.length });
      if (phase === "done") await ctx.runMutation((internal as any).e2eeMigrate.finishJob, { jobId });
      else await ctx.scheduler.runAfter(0, (internal as any).e2eeMigrate.processBatch, { jobId });
    } catch (error) {
      await ctx.runMutation((internal as any).e2eeMigrate.failJob, { jobId, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const previewPage = internalQuery({
  args: { scope: v.union(v.literal("conversation"), v.literal("channel")), targetId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { scope, targetId, paginationOpts }) => {
    const page = scope === "conversation"
      ? await ctx.db.query("messages").withIndex("by_conversation", q => q.eq("conversationId", targetId as Id<"conversations">)).order("asc").paginate(paginationOpts)
      : await ctx.db.query("channelMessages").withIndex("by_channel", q => q.eq("channelId", targetId as Id<"channels">)).order("asc").paginate(paginationOpts);
    const mapped = [];
    for (const row of page.page) {
      if (row.enc || row.text === undefined) { mapped.push({ ...row, system: false, text: undefined }); continue; }
      const author = await ctx.db.get(row.authorId);
      mapped.push({ ...row, system: author?.clerkId === "system:crystal" });
    }
    return { ...page, page: mapped };
  },
});

export const advanceJob = internalMutation({
  args: { jobId: v.id("e2eeMigrationJobs"), phase: v.union(v.literal("conversation"), v.literal("channel"), v.literal("done")), roomCursor: v.union(v.string(), v.null()), roomScanDone: v.boolean(), targetId: v.optional(v.string()), messageCursor: v.union(v.string(), v.null()), migrated: v.number(), skipped: v.number() },
  handler: async (ctx, a) => { const job = await ctx.db.get(a.jobId); if (!job || job.status !== "running") return; await ctx.db.patch(a.jobId, { phase: a.phase, roomCursor: a.roomCursor ?? undefined, roomScanDone: a.roomScanDone, activeTargetId: a.targetId, messageCursor: a.messageCursor ?? undefined, migrated: job.migrated + a.migrated, skipped: job.skipped + a.skipped, batches: job.batches + 1, updatedAt: Date.now() }); },
});
export const finishJob = internalMutation({ args: { jobId: v.id("e2eeMigrationJobs") }, handler: async (ctx, { jobId }) => { const job = await ctx.db.get(jobId); if (job?.status === "running") await ctx.db.patch(jobId, { status: "completed", phase: "done", updatedAt: Date.now(), finishedAt: Date.now() }); } });
export const failJob = internalMutation({ args: { jobId: v.id("e2eeMigrationJobs"), error: v.string() }, handler: async (ctx, { jobId, error }) => { const job = await ctx.db.get(jobId); if (job?.status === "running") await ctx.db.patch(jobId, { status: "failed", error: error.slice(0, 1000), updatedAt: Date.now(), finishedAt: Date.now() }); } });
