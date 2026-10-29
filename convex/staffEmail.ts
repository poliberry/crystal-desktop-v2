import { v } from "convex/values";

import { hasVerifiedEmail, queueEmail } from "./emailOutbox";
import { appUrl, emailConfigured } from "./lib/email";
import { audit, requireStaff } from "./lib/staff";
import { mutation, query } from "./_generated/server";

/**
 * Emailing a person from the console, and seeing what they have been sent.
 *
 * Writing to someone takes `support.act`; seeing what was sent takes `users.read`. The address
 * itself is never returned: staff pick a person, not an address, and the email goes to whatever
 * verified address the account has.
 */

const MAX_SUBJECT = 150;
const MAX_BODY = 5000;

/** Whether email is set up here, and whether this person can be reached — for the compose box to say so before staff write. */
export const status = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireStaff(ctx, "users.read");
    return { configured: emailConfigured(), reachable: await hasVerifiedEmail(ctx, userId) };
  },
});

/** The most recent emails Crystal sent or tried to send to this person, newest first. */
export const listForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireStaff(ctx, "users.read");
    const rows = await ctx.db.query("emailLog").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(40);
    return Promise.all(
      rows.map(async (row) => ({
        id: row._id,
        kind: row.kind,
        subject: row.subject,
        body: row.body,
        status: row.status,
        detail: row.detail ?? null,
        createdAt: row.createdAt,
        sentBy: row.sentBy ? ((await ctx.db.get(row.sentBy))?.username ?? null) : null,
        relatedTicketId: row.relatedTicketId ?? null,
        relatedReportId: row.relatedReportId ?? null,
      })),
    );
  },
});

/** Write to a person. Goes out from a scheduled action, so this returns at once; `listForUser` shows how it went. */
export const send = mutation({
  args: { userId: v.id("users"), subject: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "support.act");
    const user = await ctx.db.get(args.userId);
    if (!user || user.isBot) throw new Error("That account can't be emailed.");
    const subject = args.subject.trim().slice(0, MAX_SUBJECT);
    const body = args.body.trim().slice(0, MAX_BODY);
    if (subject.length < 3 || !body) throw new Error("Add a subject and a message.");
    if (!emailConfigured()) throw new Error("Email isn't set up on this deployment yet (RESEND_API_KEY and AUTH_EMAIL_FROM).");
    if (!(await hasVerifiedEmail(ctx, user._id))) throw new Error("That account has no verified email address.");

    await queueEmail(ctx, {
      userId: user._id,
      kind: "direct",
      subject,
      body,
      ctaLabel: "Open Crystal",
      ctaUrl: `${appUrl()}/`,
      // A message staff chose to write to this person, not an update about something they filed.
      respectsPreference: false,
      sentBy: staff.user._id,
    });
    await audit(ctx, staff.user._id, "users.email", { type: "user", id: user._id }, subject);
  },
});
