import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireMember } from "./communities";
import { queueEmail } from "./emailOutbox";
import { appUrl } from "./lib/email";
import { holdFile, type FileRef } from "./lib/files";
import { audit, requireStaff } from "./lib/staff";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { effectiveFileType } from "./lib/mediaType";

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

type EvidenceAttachment = { fileName: string; url?: string; fileType?: string };
type HistoryEntry = NonNullable<Evidence["history"]>[number];

/** How far back, how many rows to look through, and how many to keep. The scan
 * is bounded because these tables have no index by author. */
const HISTORY_WINDOW_MS = DAY_MS;
const HISTORY_SCAN_LIMIT = 600;
const HISTORY_KEEP = 100;
const MAX_HISTORY_TEXT = 1000;

async function attachmentUrl(
  ctx: MutationCtx,
  a: { cdnUrl?: string; storageId?: Id<"_storage"> }
): Promise<string | undefined> {
  if (a.cdnUrl) return a.cdnUrl;
  return a.storageId ? ((await ctx.storage.getUrl(a.storageId)) ?? undefined) : undefined;
}

type AttachmentRow = {
  fileName: string;
  fileType: string;
  cdnUrl?: string;
  cdnKey?: string;
  storageId?: Id<"_storage">;
};

/** Files copied into a report being built in this mutation, so `create` can hold them (see lib/files.ts). */
const evidenceFiles = new WeakMap<MutationCtx, FileRef[]>();

async function toEvidenceAttachments(ctx: MutationCtx, rows: AttachmentRow[]): Promise<EvidenceAttachment[]> {
  const held = evidenceFiles.get(ctx) ?? [];
  held.push(...rows.map((a) => ({ cdnUrl: a.cdnUrl, cdnKey: a.cdnKey, storageId: a.storageId })));
  evidenceFiles.set(ctx, held);
  return Promise.all(
    rows.map(async (a) => ({ fileName: a.fileName, fileType: effectiveFileType(a.fileType, a.fileName), url: await attachmentUrl(ctx, a) }))
  );
}

/**
 * The reported person's last 24 hours in the place the report was made (the
 * conversation or channel), oldest first.
 *
 * Deliberately limited to that place: the reporter was verified as someone who
 * can see it, and a report is not a way to pull in rooms they were never in.
 * Staff can open the account for the rest.
 */
async function recentHistory(
  ctx: MutationCtx,
  where: { kind: "dm"; conversationId: Id<"conversations"> } | { kind: "channel"; channelId: Id<"channels"> },
  authorId: Id<"users">,
  reportedId: string
): Promise<{ history: HistoryEntry[]; truncated: boolean }> {
  const since = Date.now() - HISTORY_WINDOW_MS;
  const history: HistoryEntry[] = [];
  let scanned = 0;
  let truncated = false;

  if (where.kind === "dm") {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", where.conversationId).gte("_creationTime", since))
      .order("desc")
      .take(HISTORY_SCAN_LIMIT);
    scanned = rows.length;
    for (const m of rows) {
      if (m.authorId !== authorId) continue;
      if (history.length >= HISTORY_KEEP) {
        truncated = true;
        break;
      }
      const files = await ctx.db
        .query("messageAttachments")
        .withIndex("by_message", (q) => q.eq("messageId", m._id))
        .collect();
      history.push({
        at: m._creationTime,
        text: m.text?.slice(0, MAX_HISTORY_TEXT),
        attachments: files.length ? await toEvidenceAttachments(ctx, files) : undefined,
        reported: m._id === reportedId || undefined,
      });
    }
  } else {
    const rows = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", where.channelId).gte("_creationTime", since))
      .order("desc")
      .take(HISTORY_SCAN_LIMIT);
    scanned = rows.length;
    for (const m of rows) {
      if (m.authorId !== authorId) continue;
      if (history.length >= HISTORY_KEEP) {
        truncated = true;
        break;
      }
      const files = await ctx.db
        .query("channelMessageAttachments")
        .withIndex("by_message", (q) => q.eq("messageId", m._id))
        .collect();
      history.push({
        at: m._creationTime,
        text: m.text?.slice(0, MAX_HISTORY_TEXT),
        attachments: files.length ? await toEvidenceAttachments(ctx, files) : undefined,
        reported: m._id === reportedId || undefined,
      });
    }
  }
  // Hit the scan cap: there may be older messages in the window we never read.
  if (scanned >= HISTORY_SCAN_LIMIT) truncated = true;
  return { history: history.reverse(), truncated };
}

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
    const dm = await recentHistory(
      ctx,
      { kind: "dm", conversationId: message.conversationId },
      message.authorId,
      message._id
    );
    return {
      targetUserId: message.authorId,
      evidence: {
        text: message.text?.slice(0, MAX_EVIDENCE_TEXT),
        authorName: author?.name,
        authorUsername: author?.username,
        attachments: await toEvidenceAttachments(ctx, attachments),
        context: "Direct message",
        history: dm.history,
        historyTruncated: dm.truncated || undefined,
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
    const recent = await recentHistory(
      ctx,
      { kind: "channel", channelId: channel._id },
      message.authorId,
      message._id
    );
    return {
      targetUserId: message.authorId,
      communityId: channel.communityId,
      evidence: {
        text: message.text?.slice(0, MAX_EVIDENCE_TEXT),
        authorName: author?.name,
        authorUsername: author?.username,
        attachments: await toEvidenceAttachments(ctx, attachments),
        context: `#${channel.name} in ${community?.name ?? "a community"}`,
        history: recent.history,
        historyTruncated: recent.truncated || undefined,
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
    const me = await getCurrentUserOrThrow(ctx, "file_reports");

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
    // Keep the reported files even if the message is later deleted: staff need to see them.
    for (const file of evidenceFiles.get(ctx) ?? []) await holdFile(ctx, file, id);
    evidenceFiles.delete(ctx);
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

    const [updateRows, emailRows] = await Promise.all([
      ctx.db.query("reportUpdates").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect(),
      ctx.db.query("emailLog").withIndex("by_report", (q) => q.eq("relatedReportId", reportId)).order("desc").take(20),
    ]);
    const updates = await Promise.all(
      updateRows.map(async (u) => ({
        id: u._id,
        kind: u.kind,
        status: u.status ?? null,
        body: u.body ?? null,
        emailed: u.emailed === true,
        author: (await ctx.db.get(u.authorId))?.username ?? "unknown",
        createdAt: u.createdAt,
      }))
    );

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
      /** What the reporter has been told, and the emails that went with it. */
      updates,
      emails: emailRows.map((e) => ({ id: e._id, subject: e.subject, status: e.status, detail: e.detail ?? null, createdAt: e.createdAt })),
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
    const now = Date.now();
    await ctx.db.patch(reportId, {
      assignedTo: staff.user._id,
      status: "reviewing",
      updatedAt: now,
    });
    // The reporter sees that someone is looking at it. No email for this one: it isn't news worth a message.
    if (report.status !== "reviewing") {
      await ctx.db.insert("reportUpdates", { reportId, kind: "status", status: "reviewing", authorId: staff.user._id, createdAt: now });
    }
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
    /** What the reporter is told when it closes. Separate from `resolution`, which is for staff:
     * this is written for the person who filed the report, and is the only thing they are shown. */
    closureNote: v.optional(v.string()),
    /** Email the reporter. On unless staff turn it off. */
    emailReporter: v.optional(v.boolean()),
  },
  handler: async (ctx, { reportId, status, resolution, closureNote, emailReporter }) => {
    const staff = await requireStaff(ctx, "reports.act");
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error("That report doesn't exist.");
    const closing = status === "resolved" || status === "dismissed";
    const note = resolution?.trim().slice(0, MAX_DETAILS);
    if (closing && !note) throw new Error("Say what was decided before closing a report.");
    const told = closureNote?.trim().slice(0, MAX_DETAILS) || undefined;
    if (closing && !told) throw new Error("Say why it ended so the reporter can see it — write them a note.");
    const now = Date.now();
    await ctx.db.patch(reportId, {
      status,
      updatedAt: now,
      ...(closing
        ? { resolution: note, resolvedBy: staff.user._id, resolvedAt: now }
        : { resolution: undefined, resolvedBy: undefined, resolvedAt: undefined }),
      ...(status === "open" ? { assignedTo: undefined } : {}),
    });
    if (report.status !== status) {
      await ctx.db.insert("reportUpdates", {
        reportId,
        kind: "status",
        status,
        body: closing ? told : undefined,
        authorId: staff.user._id,
        emailed: closing && emailReporter !== false ? true : undefined,
        createdAt: now,
      });
      if (closing && emailReporter !== false) await emailReporter_(ctx, report, status, told, staff.user._id);
    }
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

// --- Telling the reporter ------------------------------------------------------

const REPORT_LINK = () => ({ ctaLabel: "See your report", ctaUrl: `${appUrl()}/` });

/** The words for a report's closing email. Says what the reporter did and how it ended, never what happened to anyone else. */
async function emailReporter_(
  ctx: MutationCtx,
  report: Doc<"reports">,
  status: "resolved" | "dismissed",
  note: string | undefined,
  staffId: Id<"users">,
) {
  const outcome =
    status === "resolved"
      ? "We reviewed your report and have taken action."
      : "We reviewed your report and didn't find that action was needed.";
  await queueEmail(ctx, {
    userId: report.reporterId,
    kind: "report_closed",
    subject: "Update on your Crystal report",
    body: [outcome, "Thank you for helping keep Crystal safe. You can see this in Settings → Reports."].join("\n\n"),
    // The reporter's note lives outside the prose so the email shows it as its own block.
    note,
    ...REPORT_LINK(),
    respectsPreference: true,
    relatedReportId: report._id,
    sentBy: staffId,
  });
}

/** Write to the person who filed a report — a question, or news that it isn't finished. They see it under Settings → Reports. */
export const adminMessageReporter = mutation({
  args: { reportId: v.id("reports"), body: v.string(), email: v.optional(v.boolean()) },
  handler: async (ctx, { reportId, body, email }) => {
    const staff = await requireStaff(ctx, "reports.act");
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error("That report doesn't exist.");
    const text = body.trim().slice(0, MAX_DETAILS);
    if (!text) throw new Error("Write something first.");
    const now = Date.now();
    await ctx.db.insert("reportUpdates", {
      reportId,
      kind: "message",
      body: text,
      authorId: staff.user._id,
      emailed: email !== false ? true : undefined,
      createdAt: now,
    });
    await ctx.db.patch(reportId, { updatedAt: now });
    if (email !== false) {
      await queueEmail(ctx, {
        userId: report.reporterId,
        kind: "report_update",
        subject: "An update on your Crystal report",
        body: `Our team sent a message about your report:\n\n${text}\n\nYou can see it in Settings → Reports.`,
        ...REPORT_LINK(),
        respectsPreference: true,
        relatedReportId: reportId,
        sentBy: staff.user._id,
      });
    }
    await audit(ctx, staff.user._id, "reports.message_reporter", { type: "report", id: reportId });
  },
});

// --- The reporter's own view ----------------------------------------------------

/** How a status reads to the person who filed the report. "Dismissed" is just "closed" to them. */
function reporterStatus(status: Doc<"reports">["status"]): "received" | "in_review" | "resolved" | "closed" {
  return status === "open" ? "received" : status === "reviewing" ? "in_review" : status === "resolved" ? "resolved" : "closed";
}

/** What the reporter sees of the thing they reported — only what they themselves reported, in words they would recognise. */
function reportedLabel(report: Doc<"reports">): string {
  const who = report.evidence?.authorUsername ? `@${report.evidence.authorUsername}` : null;
  switch (report.targetType) {
    case "user":
      return who ? `The account ${who}` : "An account";
    case "community":
      return report.evidence?.context?.replace(/^Community:\s*/, "") ?? "A community";
    default:
      return who ? `A message from ${who}` : "A message";
  }
}

/** The reports the caller filed, newest first. Never anyone else's, and never staff's side of it. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db.query("reports").withIndex("by_reporter", (q) => q.eq("reporterId", me._id)).order("desc").take(100);
    return Promise.all(
      rows.map(async (r) => {
        const latest = (await ctx.db.query("reportUpdates").withIndex("by_report", (q) => q.eq("reportId", r._id)).order("desc").take(1))[0];
        return {
          id: r._id,
          targetType: r.targetType,
          about: reportedLabel(r),
          category: r.category,
          status: reporterStatus(r.status),
          createdAt: r.createdAt,
          updatedAt: latest?.createdAt ?? r.createdAt,
          unread: !!latest && latest.createdAt > (r.reporterReadAt ?? r.createdAt),
        };
      })
    );
  },
});

/** One of the caller's reports with its timeline: when it was filed, each step, and any closing note. */
export const getMine = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const report = await ctx.db.get(reportId);
    if (!report || report.reporterId !== me._id) return null;
    const updates = await ctx.db.query("reportUpdates").withIndex("by_report", (q) => q.eq("reportId", reportId)).order("asc").collect();
    const closing = [...updates].reverse().find((u) => u.kind === "status" && (u.status === "resolved" || u.status === "dismissed") && u.body);
    return {
      id: report._id,
      targetType: report.targetType,
      about: reportedLabel(report),
      category: report.category,
      details: report.details ?? null,
      // The words they reported, as captured: what they already saw when they filed it.
      quoted: report.evidence?.text ?? null,
      context: report.evidence?.context ?? null,
      status: reporterStatus(report.status),
      createdAt: report.createdAt,
      closedAt: report.resolvedAt ?? null,
      /** Why it ended, in words written for the reporter. Null when staff closed it without a note (older reports). */
      closureNote: closing?.body ?? null,
      timeline: updates.map((u) => ({
        id: u._id,
        kind: u.kind,
        status: u.status ? reporterStatus(u.status) : null,
        body: u.body ?? null,
        createdAt: u.createdAt,
      })),
    };
  },
});

/** The reporter opened a report: the updates so far are read. */
export const markRead = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const report = await ctx.db.get(reportId);
    if (!report || report.reporterId !== me._id) return;
    const latest = (await ctx.db.query("reportUpdates").withIndex("by_report", (q) => q.eq("reportId", reportId)).order("desc").take(1))[0];
    if (latest && latest.createdAt > (report.reporterReadAt ?? report.createdAt)) await ctx.db.patch(reportId, { reporterReadAt: Date.now() });
  },
});
