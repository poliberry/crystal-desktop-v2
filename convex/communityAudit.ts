import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { AUDIT_RETENTION_MS, auditIndexFor, isAuditAction, isAuditCategory } from "./lib/communityAuditActions";
import { PERMISSIONS, requireCommunityPermission } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/** Who may read the log: the owner, Administrator, or a role with View Audit Log. */
async function requireAuditReader(ctx: QueryCtx, communityId: Id<"communities">) {
  const me = await getCurrentUserOrThrow(ctx);
  const community = await ctx.db.get(communityId);
  if (!community) throw new Error("Community not found.");
  await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.VIEW_AUDIT_LOG);
  return community;
}

/**
 * A page of the community's audit log, newest first.
 *
 * Each filter is answered from an index (actor, else category) with the action narrowed on top,
 * so a long log is paged through rather than read whole.
 */
export const list = query({
  args: {
    communityId: v.id("communities"),
    category: v.optional(v.string()),
    action: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { communityId, category, action, actorId, paginationOpts }) => {
    await requireAuditReader(ctx, communityId);
    if (category !== undefined && !isAuditCategory(category)) throw new Error("Unknown category.");
    if (action !== undefined && !isAuditAction(action)) throw new Error("Unknown action.");

    const index = auditIndexFor({ category, actorId });
    const base = ctx.db.query("communityAuditLog");
    const indexed =
      index === "by_community_actor"
        ? base.withIndex("by_community_actor", (q) => q.eq("communityId", communityId).eq("actorId", actorId!))
        : index === "by_community_category"
          ? base.withIndex("by_community_category", (q) => q.eq("communityId", communityId).eq("category", category!))
          : base.withIndex("by_community_time", (q) => q.eq("communityId", communityId));
    // The indexes narrow by one field; the rest are checked as the page is read.
    const narrowed = indexed.filter((q) => {
      const checks = [];
      if (index === "by_community_actor" && category !== undefined) checks.push(q.eq(q.field("category"), category));
      if (action !== undefined) checks.push(q.eq(q.field("action"), action));
      return checks.length === 0 ? true : q.and(...checks);
    });
    const page = await narrowed.order("desc").paginate(paginationOpts);

    const names = new Map<string, { name: string; username: string; imageUrl?: string } | null>();
    const actorOf = async (id: Id<"users">) => {
      if (!names.has(id)) {
        const u: Doc<"users"> | null = await ctx.db.get(id);
        names.set(id, u ? { name: u.name, username: u.username, imageUrl: u.imageUrl } : null);
      }
      return names.get(id) ?? null;
    };
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (row) => {
          const actor = await actorOf(row.actorId);
          return {
            id: row._id,
            action: row.action,
            category: row.category,
            actorId: row.actorId,
            actorName: actor?.name ?? "Unknown",
            actorUsername: actor?.username,
            actorImageUrl: actor?.imageUrl,
            targetType: row.targetType,
            targetId: row.targetId,
            targetName: row.targetName,
            details: row.details,
            createdAt: row.createdAt,
          };
        }),
      ),
    };
  },
});

/** Who appears in the recent log, for the "by" filter. Bounded: the latest 400 entries, not a scan of the whole log. */
export const recentActors = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    await requireAuditReader(ctx, communityId);
    const rows = await ctx.db
      .query("communityAuditLog")
      .withIndex("by_community_time", (q) => q.eq("communityId", communityId))
      .order("desc")
      .take(400);
    const ids = [...new Set(rows.map((r) => r.actorId))];
    const users = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return users.filter((u): u is Doc<"users"> => !!u).map((u) => ({ id: u._id, name: u.name, username: u.username }));
  },
});

/** Delete rows past the retention window, a batch at a time. Run daily by convex/crons.ts. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    const old = await ctx.db.query("communityAuditLog").withIndex("by_time", (q) => q.lt("createdAt", cutoff)).take(500);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.communityAudit.prune, {});
  },
});

/** Drop a deleted community's log, a batch at a time. */
export const purgeCommunity = internalMutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const rows = await ctx.db.query("communityAuditLog").withIndex("by_community_time", (q) => q.eq("communityId", communityId)).take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 500) await ctx.scheduler.runAfter(0, internal.communityAudit.purgeCommunity, { communityId });
  },
});
