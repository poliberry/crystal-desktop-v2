import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireMember } from "./communities";
import { audit, requireStaff } from "./lib/staff";
import { getCurrentUserOrThrow } from "./users";

const categoryValidator = v.union(
  v.literal("spam"),
  v.literal("harassment"),
  v.literal("hate"),
  v.literal("sexual"),
  v.literal("violence"),
  v.literal("self_harm"),
  v.literal("impersonation"),
  v.literal("scam"),
  v.literal("other")
);

const targetTypeValidator = v.union(
  v.literal("user"),
  v.literal("message"),
  v.literal("channelMessage"),
  v.literal("community")
);

type Evidence = NonNullable<Doc<"reports">["evidence"]>;

/** Most reports one person can make in a day. A report is a request for staff
 * attention, and a limit is what keeps it from being turned on somebody. */
const MAX_REPORTS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DETAILS = 1000;
const MAX_EVIDENCE_TEXT = 4000;

/**
 * What is being reported, worked out here from the target itself.
 *
 * Never taken from the reporter: a report that carried whatever text the client
 * sent could be used to put words in somebody's mouth. And the reporter has to be
 * someone who could have seen the thing — a member of the conversation, of the
 * server — so a report is not a way to read what you were never in.
 */
async function buildEvidence(
  ctx: MutationCtx,
  reporter: Doc<"users">,
  targetType: Doc<"reports">["targetType"],
  targetId: string
): Promise<{
  targetUserId?: Id<"users">;
  communityId?: Id<"communities">;
  evidence?: Evidence;
}> {
  if (targetType === "user") {
    const user = await ctx.db.get(targetId as Id<"users">);
    if (!user) throw new Error("That user doesn't exist.");
    if (user._id === reporter._id) throw new Error("You can't report yourself.");
    return {
      targetUserId: user._id,
      evidence: { authorName: user.name, authorUsername: user.username },
    };
  }

  if (targetType === "message") {
    const message = await ctx.db.get(targetId as Id<"messages">);
    if (!message) throw new Error("That message doesn't exist any more.");
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", message.conversationId).eq("userId", reporter._id)
      )
      .unique();
    if (!membership) throw new Error("You can only report messages you can see.");
    if (message.authorId === reporter._id) throw new Error("You can't report your own message.");
    const author = await ctx.db.get(message.authorId);
    const attachments = await ctx.db
      .query("messageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .collect();
    return {
      targetUserId: message.authorId,
      evidence: {
        text: message.text?.slice(0, MAX_EVIDENCE_TEXT),
        authorName: author?.name,
        authorUsername: author?.username,
        attachments: attachments.map((a) => ({
          fileName: a.fileName,
          url: a.cdnUrl,
        })),
        context: "Direct message",
      },
    };
  }

  if (targetType === "channelMessage") {
    const message = await ctx.db.get(targetId as Id<"channelMessages">);
    if (!message) throw new Error("That message doesn't exist any more.");
    const channel = await ctx.db.get(message.channelId);
    if (!channel) throw new Error("That message doesn't exist any more.");
    await requireMember(ctx, channel.communityId, reporter._id);
    if (message.authorId === reporter._id) throw new Error("You can't report your own message.");
    const community = await ctx.db.get(channel.communityId);
    const author = await ctx.db.get(message.authorId);
    const attachments = await ctx.db
      .query("channelMessageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .collect();
    return {
      targetUserId: message.authorId,
      communityId: channel.communityId,
      evidence: {
        text: message.text?.slice(0, MAX_EVIDENCE_TEXT),
        authorName: author?.name,
        authorUsername: author?.username,
        attachments: attachments.map((a) => ({ fileName: a.fileName, url: a.cdnUrl })),
        context: `#${channel.name} in ${community?.name ?? "a community"}`,
      },
    };
  }

  const community = await ctx.db.get(targetId as Id<"communities">);
  if (!community) throw new Error("That community doesn't exist.");
  await requireMember(ctx, community._id, reporter._id);
  if (community.ownerId === reporter._id) throw new Error("You can't report your own community.");
  const owner = await ctx.db.get(community.ownerId);
  return {
    targetUserId: community.ownerId,
    communityId: community._id,
    evidence: {
      authorName: owner?.name,
      authorUsername: owner?.username,
      context: `Community: ${community.name}`,
    },
  };
}

/**
 * Report a person, a message or a community.
 *
 * One open report per reporter per target: reporting the same thing twice hands
 * back the first rather than stacking them, so repeat clicks don't read as many
 * people.
 */
export const create = mutation({
  args: {
    targetType: targetTypeValidator,
    targetId: v.string(),
    category: categoryValidator,
    details: v.optional(v.string()),
  },
  handler: async (ctx, { targetType, targetId, category, details }) => {
    const me = await getCurrentUserOrThrow(ctx);

    const mine = await ctx.db
      .query("reports")
      .withIndex("by_reporter", (q) => q.eq("reporterId", me._id).gte("createdAt", Date.now() - DAY_MS))
      .collect();
    const duplicate = mine.find(
      (r) =>
        r.targetType === targetType &&
        r.targetId === targetId &&
        (r.status === "open" || r.status === "reviewing")
    );
    if (duplicate) return { id: duplicate._id, duplicate: true };
    if (mine.length >= MAX_REPORTS_PER_DAY) {
      throw new Error("You've sent a lot of reports today. Try again tomorrow.");
    }

    const { targetUserId, communityId, evidence } = await buildEvidence(ctx, me, targetType, targetId);
    const now = Date.now();
    const id = await ctx.db.insert("reports", {
      reporterId: me._id,
      targetType,
      targetId,
      targetUserId,
      communityId,
      category,
      details: details?.trim().slice(0, MAX_DETAILS) || undefined,
      evidence,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    return { id, duplicate: false };
  },
});

// --- Staff ---------------------------------------------------------------------

const statusValidator = v.union(
  v.literal("open"),
  v.literal("reviewing"),
  v.literal("resolved"),
  v.literal("dismissed")
);

/** The reports, newest first, for one status — or the ones that still need
 * somebody. */
export const adminList = query({
  args: { status: v.optional(statusValidator), limit: v.optional(v.number()) },
  handler: async (ctx, { status, limit }) => {
    await requireStaff(ctx, "reports.read");
    const cap = Math.min(Math.max(limit ?? 100, 1), 200);

    const statuses = status ? [status] : (["open", "reviewing"] as const);
    const rows: Doc<"reports">[] = [];
    for (const s of statuses) {
      rows.push(
        ...(await ctx.db
          .query("reports")
          .withIndex("by_status", (q) => q.eq("status", s))
          .order("desc")
          .take(cap))
      );
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      rows.slice(0, cap).map(async (row) => {
        const [reporter, target, assignee] = await Promise.all([
          ctx.db.get(row.reporterId),
          row.targetUserId ? ctx.db.get(row.targetUserId) : null,
          row.assignedTo ? ctx.db.get(row.assignedTo) : null,
        ]);
        return {
          id: row._id,
          targetType: row.targetType,
          category: row.category,
          status: row.status,
          createdAt: row.createdAt,
          reporter: reporter?.username ?? "unknown",
          target: target ? { name: target.name, username: target.username } : null,
          assignee: assignee?.username ?? null,
          preview: row.evidence?.text?.slice(0, 140) ?? row.evidence?.context ?? null,
        };
      })
    );
  },
});

/** How many reports of each status there are, for the console's badges. */
export const adminCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "reports.read");
    const count = async (status: Doc<"reports">["status"]) =>
      (
        await ctx.db
          .query("reports")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(500)
      ).length;
    const [open, reviewing] = await Promise.all([count("open"), count("reviewing")]);
    return { open, reviewing };
  },
});

export const adminGet = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    await requireStaff(ctx, "reports.read");
    const report = await ctx.db.get(reportId);
    if (!report) return null;

    const [reporter, target, resolver, assignee, community, notes, others] = await Promise.all([
      ctx.db.get(report.reporterId),
      report.targetUserId ? ctx.db.get(report.targetUserId) : null,
      report.resolvedBy ? ctx.db.get(report.resolvedBy) : null,
      report.assignedTo ? ctx.db.get(report.assignedTo) : null,
      report.communityId ? ctx.db.get(report.communityId) : null,
      ctx.db
        .query("reportNotes")
        .withIndex("by_report", (q) => q.eq("reportId", reportId))
        .collect(),
      // Everything else said about the same person: one report is an incident,
      // several is a pattern, and staff should see which this is.
      report.targetUserId
        ? ctx.db
            .query("reports")
            .withIndex("by_target_user", (q) => q.eq("targetUserId", report.targetUserId))
            .collect()
        : [],
    ]);

    const noteRows = await Promise.all(
      notes.map(async (note) => ({
        id: note._id,
        body: note.body,
        createdAt: note.createdAt,
        author: (await ctx.db.get(note.authorId))?.username ?? "unknown",
      }))
    );

    return {
      id: report._id,
      targetType: report.targetType,
      targetId: report.targetId,
      category: report.category,
      details: report.details,
      evidence: report.evidence,
      status: report.status,
      resolution: report.resolution,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
      reporter: reporter ? { name: reporter.name, username: reporter.username, id: reporter._id } : null,
      target: target
        ? { name: target.name, username: target.username, id: target._id, imageUrl: target.imageUrl }
        : null,
      community: community ? { id: community._id, name: community.name } : null,
      assignee: assignee?.username ?? null,
      resolver: resolver?.username ?? null,
      notes: noteRows,
      otherReportsAboutTarget: others
        .filter((r) => r._id !== report._id)
        .map((r) => ({ id: r._id, category: r.category, status: r.status, createdAt: r.createdAt }))
        .slice(0, 20),
    };
  },
});

/** Take a report: assign it to yourself and mark it as being looked at. */
export const adminClaim = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const staff = await requireStaff(ctx, "reports.act");
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error("That report doesn't exist.");
    if (report.status === "resolved" || report.status === "dismissed") {
      throw new Error("That report is already closed.");
    }
    await ctx.db.patch(reportId, {
      assignedTo: staff.user._id,
      status: "reviewing",
      updatedAt: Date.now(),
    });
    await audit(ctx, staff.user._id, "reports.claim", { type: "report", id: reportId });
  },
});

/** Close a report, resolved or dismissed, with what was decided. Reopening is
 * the same call with `open`. */
export const adminSetStatus = mutation({
  args: {
    reportId: v.id("reports"),
    status: statusValidator,
    resolution: v.optional(v.string()),
  },
  handler: async (ctx, { reportId, status, resolution }) => {
    const staff = await requireStaff(ctx, "reports.act");
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error("That report doesn't exist.");
    const closing = status === "resolved" || status === "dismissed";
    const note = resolution?.trim().slice(0, MAX_DETAILS);
    if (closing && !note) throw new Error("Say what was decided before closing a report.");
    const now = Date.now();
    await ctx.db.patch(reportId, {
      status,
      updatedAt: now,
      ...(closing
        ? { resolution: note, resolvedBy: staff.user._id, resolvedAt: now }
        : { resolution: undefined, resolvedBy: undefined, resolvedAt: undefined }),
      ...(status === "open" ? { assignedTo: undefined } : {}),
    });
    await audit(
      ctx,
      staff.user._id,
      `reports.${status}`,
      { type: "report", id: reportId },
      note
    );
  },
});

export const adminAddNote = mutation({
  args: { reportId: v.id("reports"), body: v.string() },
  handler: async (ctx, { reportId, body }) => {
    const staff = await requireStaff(ctx, "reports.act");
    const text = body.trim().slice(0, MAX_DETAILS);
    if (!text) return;
    if (!(await ctx.db.get(reportId))) throw new Error("That report doesn't exist.");
    await ctx.db.insert("reportNotes", {
      reportId,
      authorId: staff.user._id,
      body: text,
      createdAt: Date.now(),
    });
    await audit(ctx, staff.user._id, "reports.note", { type: "report", id: reportId });
  },
});
