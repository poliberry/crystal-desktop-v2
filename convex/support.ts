import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
    return ctx.db.query("supportTickets").withIndex("by_user", (q) => q.eq("userId", me._id)).order("desc").take(100);
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
    return { ticket, messages: await Promise.all(messages.map(async (message) => ({ ...message, author: (await ctx.db.get(message.authorId))?.username ?? "unknown" }))) };
  },
});

export const adminReply = mutation({
  args: { ticketId: v.id("supportTickets"), body: v.string(), internal: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "support.act");
    const body = args.body.trim().slice(0, 4000);
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket || !body) throw new Error("Ticket or reply not found.");
    const now = Date.now();
    await ctx.db.insert("supportTicketMessages", { ticketId: args.ticketId, authorId: staff.user._id, body, internal: args.internal ?? false, createdAt: now });
    if (!args.internal) await ctx.db.patch(args.ticketId, { status: "waiting_on_user", updatedAt: now });
    await audit(ctx, staff.user._id, "support.reply", { type: "supportTicket", id: args.ticketId });
  },
});

export const adminSetStatus = mutation({
  args: { ticketId: v.id("supportTickets"), status, priority: v.optional(v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent"))) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "support.act");
    if (!(await ctx.db.get(args.ticketId))) throw new Error("Ticket not found.");
    await ctx.db.patch(args.ticketId, { status: args.status, ...(args.priority ? { priority: args.priority } : {}), updatedAt: Date.now() });
    await audit(ctx, staff.user._id, `support.${args.status}`, { type: "supportTicket", id: args.ticketId });
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
      ticket: { id: ticket._id, subject: ticket.subject, status: ticket.status, category: ticket.category, createdAt: ticket.createdAt },
      messages: await Promise.all(
        messages
          .filter((m) => !m.internal)
          .map(async (m) => ({
            id: m._id,
            body: m.body,
            createdAt: m.createdAt,
            fromStaff: m.authorId !== me._id,
            author: m.authorId === me._id ? "You" : (await ctx.db.get(m.authorId))?.name ?? "Crystal support",
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
    await ctx.db.patch(ticketId, { status: "open", updatedAt: now });
  },
});
