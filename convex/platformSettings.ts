import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { factorSummary } from "./lib/secondFactor";
import { audit, requireStaff } from "./lib/staff";
import { platformSecurity } from "./lib/stepUp";

/**
 * Settings for the whole platform, edited from the admin console.
 *
 * Today one: whether staff must have two-step verification switched on to use the console. Both
 * functions go through `requireStaff`, so they ask for a code like every other administrative
 * function.
 */

export const security = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "staff.manage");
    return platformSecurity(ctx);
  },
});

export const setRequireStaffTwoFactor = mutation({
  args: { required: v.boolean() },
  handler: async (ctx, { required }) => {
    const staff = await requireStaff(ctx, "staff.manage");
    // Switching it on for everyone while the person doing it hasn't got it would lock them out of the console they are standing in.
    if (required && !(await factorSummary(ctx, staff.user._id)).enrolled) {
      throw new Error("Turn on two-step verification on your own account first, in Settings → Security.");
    }
    const row = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "security")).unique();
    if ((row?.requireStaffTwoFactor ?? false) === required) return;
    const patch = { requireStaffTwoFactor: required, updatedBy: staff.user._id, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("platformSettings", { key: "security", ...patch });
    await audit(
      ctx,
      staff.user._id,
      "platform.security.staff2sv",
      { type: "platform", id: "security" },
      required ? "Two-step verification is now required for staff" : "Two-step verification is no longer required for staff",
    );
  },
});
