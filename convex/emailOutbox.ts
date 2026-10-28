import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { emailConfigured, renderEmail, sendEmail } from "./lib/email";
import { firstNameOf } from "./lib/emailBrand";

/**
 * The outbox for email about support tickets, reports and staff messages.
 *
 * A mutation never sends: it calls `queueEmail`, which writes the `emailLog` row and schedules
 * `deliver`. The action looks up where to send, honours the person's "email me" setting, sends,
 * and writes the outcome back. So every email has a row saying what happened to it, and a send
 * that fails cannot fail (or slow down) the reply or status change that caused it.
 */

export type EmailKind = Doc<"emailLog">["kind"];

export interface QueuedEmail {
  userId: Id<"users">;
  kind: EmailKind;
  subject: string;
  /** Plain paragraphs, separated by a blank line. */
  body: string;
  /** Why something ended — rendered as its own block, not buried in prose. */
  note?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Skip it when the person has turned support/report email off. Staff's own direct emails don't. */
  respectsPreference: boolean;
  relatedTicketId?: Id<"supportTickets">;
  relatedReportId?: Id<"reports">;
  sentBy?: Id<"users">;
}

/** Record an email and schedule its delivery. Call from the mutation that caused it. */
export async function queueEmail(ctx: MutationCtx, email: QueuedEmail): Promise<Id<"emailLog">> {
  const logId = await ctx.db.insert("emailLog", {
    ...email,
    subject: email.subject.slice(0, 200),
    body: email.body.slice(0, 8000),
    note: email.note?.slice(0, 2000),
    status: "queued",
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.emailOutbox.deliver, { logId });
  return logId;
}

/** The address to write to: a verified one, and only for a real person's account. */
async function addressFor(ctx: QueryCtx, userId: Id<"users">): Promise<string | null> {
  const user = await ctx.db.get(userId);
  if (!user || user.isBot || user.isGuest) return null;
  const rows = await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  return rows.find((row) => row.verifiedAt !== undefined)?.email ?? null;
}

/** The reader's first name for the greeting — never a bot, guest or deleted placeholder. */
async function firstNameFor(ctx: QueryCtx, userId: Id<"users">): Promise<string | undefined> {
  const user = await ctx.db.get(userId);
  if (!user || user.isBot || user.isGuest || user.deletedAt) return undefined;
  return firstNameOf(user.name);
}

/** Whether this account has a verified address to email, without saying what it is. */
export async function hasVerifiedEmail(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  return (await addressFor(ctx, userId)) !== null;
}

export const load = internalQuery({
  args: { logId: v.id("emailLog") },
  handler: async (ctx, { logId }) => {
    const row = await ctx.db.get(logId);
    if (!row || row.status !== "queued") return null;
    const settings = await ctx.db.query("notificationSettings").withIndex("by_user", (q) => q.eq("userId", row.userId)).unique();
    return {
      row,
      address: await addressFor(ctx, row.userId),
      firstName: await firstNameFor(ctx, row.userId),
      optedOut: settings?.emailSupportUpdates === false,
    };
  },
});

export const finish = internalMutation({
  args: {
    logId: v.id("emailLog"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { logId, status, detail }) => {
    await ctx.db.patch(logId, { status, detail, ...(status === "sent" ? { sentAt: Date.now() } : {}) });
  },
});

export const deliver = internalAction({
  args: { logId: v.id("emailLog") },
  handler: async (ctx, { logId }) => {
    const loaded = await ctx.runQuery(internal.emailOutbox.load, { logId });
    if (!loaded) return;
    const { row, address, firstName, optedOut } = loaded;

    const skip = async (detail: string) => {
      await ctx.runMutation(internal.emailOutbox.finish, { logId, status: "skipped", detail });
    };
    if (!emailConfigured()) return skip("Email isn't set up on this deployment (RESEND_API_KEY / AUTH_EMAIL_FROM).");
    if (!address) return skip("The account has no verified email address.");
    if (row.respectsPreference && optedOut) return skip("They turned off emails about their requests.");

    const { text, html } = renderEmail({
      subject: row.subject,
      firstName,
      paragraphs: row.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
      note: row.note ?? undefined,
      ctaLabel: row.ctaLabel,
      ctaUrl: row.ctaUrl,
    });
    try {
      await sendEmail({ to: address, subject: row.subject, text, html });
      await ctx.runMutation(internal.emailOutbox.finish, { logId, status: "sent" });
    } catch (error) {
      await ctx.runMutation(internal.emailOutbox.finish, {
        logId,
        status: "failed",
        detail: error instanceof Error ? error.message.slice(0, 300) : "It could not be sent.",
      });
    }
  },
});
