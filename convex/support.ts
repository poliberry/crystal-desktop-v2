import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { hasVerifiedEmail, queueEmail } from "./emailOutbox";
import { appUrl } from "./lib/email";
import { audit, requireStaff } from "./lib/staff";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

const category = v.union(v.literal("account"), v.literal("billing"), v.literal("community"), v.literal("technical"), v.literal("other"));
const status = v.union(v.literal("open"), v.literal("in_progress"), v.literal("waiting_on_user"), v.literal("resolved"), v.literal("closed"));

export const create = mutation({
  args: { subject: v.string(), category, body: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const subject = args.subject.trim().slice(0, 120);
    const body = args.body.trim().slice(0, 4000);
    if (subject.length < 3 || !body) throw new Error("Add a subject and message.");
    const recent = await ctx.db.query("supportTickets").withIndex("by_user", (q) => q.eq("userId", me._id)).order("desc").take(20);
    if (recent.filter((t) => t.status !== "closed" && t.status !== "resolved").length >= 5) {
      throw new Error("You have several open tickets already. Reply to one of those, or wait for it to be resolved.");
    }
    const now = Date.now();
    const ticketId = await ctx.db.insert("supportTickets", { userId: me._id, subject, category: args.category, priority: "normal", status: "open", createdAt: now, updatedAt: now });
    await ctx.db.insert("supportTicketMessages", { ticketId, authorId: me._id, body, internal: false, createdAt: now });
    return ticketId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db.query("supportTickets").withIndex("by_user", (q) => q.eq("userId", me._id)).order("desc").take(100);
    // Only what the owner is meant to see: no assignee, no priority.
    return rows.map((t) => ({
      _id: t._id,
      subject: t.subject,
      category: t.category,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      onBehalf: t.createdByStaffId !== undefined,
      unread: (t.lastStaffReplyAt ?? 0) > (t.userReadAt ?? 0),
      closureNote: t.closureNote ?? null,
      resolvedAt: t.resolvedAt ?? null,
    }));
  },
});

export const adminList = query({
  args: { status: v.optional(status) },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "support.read");
    const rows = args.status
      ? await ctx.db.query("supportTickets").withIndex("by_status", (q) => q.eq("status", args.status!)).order("desc").take(200)
      : await ctx.db.query("supportTickets").order("desc").take(200);
    return Promise.all(rows.map(async (row) => {
      const [user, assignee, messages] = await Promise.all([
        ctx.db.get(row.userId), row.assignedTo ? ctx.db.get(row.assignedTo) : null,
        ctx.db.query("supportTicketMessages").withIndex("by_ticket", (q) => q.eq("ticketId", row._id)).order("desc").take(1),
      ]);
      return { ...row, user: user ? { id: user._id, name: user.name, username: user.username } : null, assignee: assignee?.username ?? null, preview: messages[0]?.body.slice(0, 160) ?? null };
    }));
  },
});

export const adminGet = query({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, { ticketId }) => {
    await requireStaff(ctx, "support.read");
    const ticket = await ctx.db.get(ticketId);
    if (!ticket) return null;
    const messages = await ctx.db.query("supportTicketMessages").withIndex("by_ticket", (q) => q.eq("ticketId", ticketId)).order("asc").collect();
    const emails = await ctx.db.query("emailLog").withIndex("by_ticket", (q) => q.eq("relatedTicketId", ticketId)).order("desc").take(20);
    const openedBy = ticket.createdByStaffId ? (await ctx.db.get(ticket.createdByStaffId))?.username ?? null : null;
    const resolvedBy = ticket.resolvedBy ? (await ctx.db.get(ticket.resolvedBy))?.username ?? null : null;
    return {
      ticket,
      openedBy,
      resolvedBy,
      emails: emails.map((e) => ({ id: e._id, kind: e.kind, subject: e.subject, status: e.status, detail: e.detail ?? null, createdAt: e.createdAt })),
      messages: await Promise.all(messages.map(async (message) => ({ ...message, author: (await ctx.db.get(message.authorId))?.username ?? "unknown" }))),
    };
  },
});

/** The link in these emails: the app, where the request is under Settings → Support. */
const SUPPORT_LINK = () => ({ ctaLabel: "Open Crystal", ctaUrl: `${appUrl()}/` });

/** Tell the customer a ticket moved. Not sent when staff wrote an internal note, and not when staff turned it off. */
async function emailTicket(
  ctx: Parameters<typeof queueEmail>[0],
  ticket: Doc<"supportTickets">,
  staffId: Id<"users">,
  kind: "ticket_opened" | "ticket_reply" | "ticket_resolved",
  subject: string,
  body: string,
  note?: string,
) {
  await queueEmail(ctx, {
    userId: ticket.userId,
    kind,
    subject,
    body,
    note,
    ...SUPPORT_LINK(),
    respectsPreference: true,
    relatedTicketId: ticket._id,
    sentBy: staffId,
  });
}

export const adminReply = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    body: v.string(),
    internal: v.optional(v.boolean()),
    /** Email the customer the reply. On unless staff turn it off. */
    email: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "support.act");
    const body = args.body.trim().slice(0, 4000);
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket || !body) throw new Error("Ticket or reply not found.");
    const now = Date.now();
    await ctx.db.insert("supportTicketMessages", { ticketId: args.ticketId, authorId: staff.user._id, body, internal: args.internal ?? false, createdAt: now });
    if (!args.internal) {
      await ctx.db.patch(args.ticketId, { status: "waiting_on_user", updatedAt: now, lastStaffReplyAt: now });
      if (args.email !== false) {
        await emailTicket(ctx, ticket, staff.user._id, "ticket_reply", `Re: ${ticket.subject}`, `Crystal support replied to your request “${ticket.subject}”:\n\n${body}\n\nYou can answer from Settings → Support in Crystal.`);
      }
    }
    await audit(ctx, staff.user._id, "support.reply", { type: "supportTicket", id: args.ticketId });
  },
});

/**
 * Open a ticket for a customer, from the console: they wrote in some other way (an email, a
 * chat, a call) and the conversation should live here, where they can also see and answer it.
 * The first message is from staff and visible to the customer; an internal note can ride along.
 */
export const adminCreate = mutation({
  args: {
    userId: v.id("users"),
    subject: v.string(),
    category,
    body: v.string(),
    internalNote: v.optional(v.string()),
    email: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "support.act");
    const user = await ctx.db.get(args.userId);
    if (!user || user.isBot) throw new Error("That account can't have a ticket.");
    const subject = args.subject.trim().slice(0, 120);
    const body = args.body.trim().slice(0, 4000);
    if (subject.length < 3 || !body) throw new Error("Add a subject and a message for the customer.");
    const now = Date.now();
    const ticketId = await ctx.db.insert("supportTickets", {
      userId: user._id,
      subject,
      category: args.category,
      priority: "normal",
      // The customer has the next move.
      status: "waiting_on_user",
      assignedTo: staff.user._id,
      createdByStaffId: staff.user._id,
      lastStaffReplyAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("supportTicketMessages", { ticketId, authorId: staff.user._id, body, internal: false, createdAt: now });
    const note = args.internalNote?.trim().slice(0, 4000);
    if (note) await ctx.db.insert("supportTicketMessages", { ticketId, authorId: staff.user._id, body: note, internal: true, createdAt: now + 1 });
    if (args.email !== false) {
      const ticket = (await ctx.db.get(ticketId))!;
      await emailTicket(ctx, ticket, staff.user._id, "ticket_opened", `Crystal support: ${subject}`, `Crystal support opened a request for you: “${subject}”.\n\n${body}\n\nYou can read it and answer from Settings → Support in Crystal.`);
    }
    await audit(ctx, staff.user._id, "support.create", { type: "supportTicket", id: ticketId }, `for @${user.username}`);
    return ticketId;
  },
});

export const adminSetStatus = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    status,
    priority: v.optional(v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent"))),
    /** Why a resolved/closed ticket ended, in words written for the customer. Shown under Settings → Support. */
    closureNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "support.act");
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket) throw new Error("Ticket not found.");
    const now = Date.now();
    const finishing = args.status === "resolved" || args.status === "closed";
    const reopening = !finishing && (ticket.status === "resolved" || ticket.status === "closed");
    const newlyFinishing = finishing && ticket.status !== args.status;
    // A priority-only change keeps the existing note; closing needs one so the customer sees why it ended.
    const note = args.closureNote?.trim().slice(0, 1000) || ticket.closureNote?.trim().slice(0, 1000) || undefined;
    if (newlyFinishing && (!note || note.length < 3)) throw new Error("Say why this is closed so the customer can see it.");
    await ctx.db.patch(args.ticketId, {
      status: args.status,
      ...(args.priority ? { priority: args.priority } : {}),
      ...(finishing ? { closureNote: note, resolvedAt: now, resolvedBy: staff.user._id } : {}),
      ...(reopening ? { closureNote: undefined, resolvedAt: undefined, resolvedBy: undefined } : {}),
      // Keeping the note without moving status (a priority change on a closed ticket) still saves an edited note.
      ...(ticket.status === args.status && finishing && args.closureNote?.trim() ? { closureNote: args.closureNote.trim().slice(0, 1000) } : {}),
      updatedAt: now,
    });
    // Telling them it is done is the one status change worth an email; the rest are bookkeeping.
    if (newlyFinishing) {
      await ctx.db.patch(args.ticketId, { lastStaffReplyAt: now });
      await emailTicket(
        ctx,
        ticket,
        staff.user._id,
        "ticket_resolved",
        `Your request was ${args.status}: ${ticket.subject}`,
        [
          `Crystal support marked your request “${ticket.subject}” as ${args.status}.`,
          args.status === "resolved"
            ? "If it isn't sorted, reply to it from Settings → Support and it will be reopened."
            : "If you still need help, send a new request from Settings → Support.",
        ].join("\n\n"),
        // The closure reason lives outside the prose so the email shows it as its own block.
        note,
      );
    }
    await audit(ctx, staff.user._id, `support.${args.status}`, { type: "supportTicket", id: args.ticketId }, note);
  },
});

export const adminAssign = mutation({
  args: { ticketId: v.id("supportTickets"), assigneeId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "support.act");
    if (!(await ctx.db.get(args.ticketId))) throw new Error("Ticket not found.");
    await ctx.db.patch(args.ticketId, { assignedTo: args.assigneeId, updatedAt: Date.now() });
    await audit(ctx, staff.user._id, "support.assign", { type: "supportTicket", id: args.ticketId });
  },
});

/** One of the caller's own tickets, with the replies they are allowed to see —
 * staff-only notes stay on staff's side. */
export const get = query({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, { ticketId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const ticket = await ctx.db.get(ticketId);
    if (!ticket || ticket.userId !== me._id) return null;
    const messages = await ctx.db
      .query("supportTicketMessages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", ticketId))
      .order("asc")
      .collect();
    return {
      ticket: {
        id: ticket._id,
        subject: ticket.subject,
        status: ticket.status,
        category: ticket.category,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        onBehalf: ticket.createdByStaffId !== undefined,
        closureNote: ticket.closureNote ?? null,
        resolvedAt: ticket.resolvedAt ?? null,
      },
      messages: await Promise.all(
        messages
          .filter((m) => !m.internal)
          .map(async (m) => ({
            id: m._id,
            body: m.body,
            createdAt: m.createdAt,
            fromStaff: m.authorId !== me._id,
            // Staff appear as the team, not by their own name.
            author: m.authorId === me._id ? "You" : "Crystal support",
          })),
      ),
    };
  },
});

/** The user answers their own ticket. A closed one stays closed. */
export const reply = mutation({
  args: { ticketId: v.id("supportTickets"), body: v.string() },
  handler: async (ctx, { ticketId, body }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const ticket = await ctx.db.get(ticketId);
    if (!ticket || ticket.userId !== me._id) throw new Error("That isn't yours.");
    if (ticket.status === "closed") throw new Error("That ticket is closed. Open a new one.");
    const text = body.trim().slice(0, 4000);
    if (!text) throw new Error("Write something first.");
    const now = Date.now();
    await ctx.db.insert("supportTicketMessages", { ticketId, authorId: me._id, body: text, internal: false, createdAt: now });
    await ctx.db.patch(ticketId, {
      status: "open",
      updatedAt: now,
      ...(ticket.status === "resolved" ? { closureNote: undefined, resolvedAt: undefined, resolvedBy: undefined } : {}),
    });
  },
});

/** The customer opened a ticket's thread: whatever staff said so far is read. */
export const markRead = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, { ticketId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const ticket = await ctx.db.get(ticketId);
    if (!ticket || ticket.userId !== me._id) return;
    if ((ticket.lastStaffReplyAt ?? 0) > (ticket.userReadAt ?? 0)) await ctx.db.patch(ticketId, { userReadAt: Date.now() });
  },
});

/** The customer marks their own ticket resolved — it's sorted, or they no longer need it. Replying to it reopens it. */
export const closeMine = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, { ticketId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const ticket = await ctx.db.get(ticketId);
    if (!ticket || ticket.userId !== me._id) throw new Error("That isn't yours.");
    if (ticket.status === "closed" || ticket.status === "resolved") return;
    await ctx.db.patch(ticketId, { status: "resolved", resolvedAt: Date.now(), updatedAt: Date.now() });
  },
});

/** Whether the caller gets email about their tickets and reports, and whether they have an address to get it at. */
export const emailPreference = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const settings = await ctx.db.query("notificationSettings").withIndex("by_user", (q) => q.eq("userId", me._id)).unique();
    return { enabled: settings?.emailSupportUpdates !== false, hasAddress: await hasVerifiedEmail(ctx, me._id) };
  },
});

export const setEmailPreference = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db.query("notificationSettings").withIndex("by_user", (q) => q.eq("userId", me._id)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { emailSupportUpdates: enabled });
      return;
    }
    // First write makes the row, so the other switches get their defaults here (see notificationSettings.update).
    await ctx.db.insert("notificationSettings", {
      userId: me._id,
      dmMessages: true,
      channelMessages: true,
      friendRequests: true,
      incomingCalls: true,
      callActivity: true,
      streamActivity: true,
      replies: true,
      emailSupportUpdates: enabled,
    });
  },
});
