import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCurrentUserOrNull } from "../users";
import { can, isDestructivePermission, type StaffPermission, type StaffRole } from "./staffPermissions";
import { isMutationCtx, platformSecurity, requireAdminAssurance } from "./stepUp";

/**
 * Server-side checks for the admin console.
 *
 * Every console query, mutation and action goes through `requireStaff` first,
 * naming the one permission it needs. Nothing here trusts the client: who is
 * signed in comes from the auth identity, and what they may do comes from their
 * row in `staffMembers`.
 */

export interface StaffContext {
  user: Doc<"users">;
  staff: Doc<"staffMembers">;
  roles: StaffRole[];
}

/** The caller as staff, or `null` if they aren't (or have been revoked). */
export async function getStaff(ctx: QueryCtx): Promise<StaffContext | null> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) return null;
  const staff = await ctx.db
    .query("staffMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .unique();
  if (!staff || staff.revokedAt !== undefined) return null;
  return { user, staff, roles: staff.roles as StaffRole[] };
}

/**
 * The caller as staff with `permission`, or an error.
 *
 * The same message for "not staff" and "staff without this permission", so the
 * response doesn't tell a curious user which parts of the console exist.
 */
export async function requireStaff(
  ctx: QueryCtx,
  permission: StaffPermission,
  options: { destructive?: boolean } = {},
): Promise<StaffContext> {
  const staff = await getStaff(ctx);
  if (!staff || !can(staff.roles, permission)) throw new Error("Not allowed.");
  // A query can't be paused for a code and retried, and none of the console's queries destroy
  // anything, so only a mutation is ever asked for one.
  const destructive = (options.destructive ?? isDestructivePermission(permission)) && isMutationCtx(ctx);
  await assertStaffAssurance(ctx, staff, { destructive });
  return staff;
}

/**
 * The two-step rules for staff.
 *
 * Every administrative function goes through `requireStaff`, so this is the one place the
 * platform's rules are enforced. Two separate rules:
 *
 *   - When the platform requires two-step verification, staff without it are turned away from
 *     everything until they set it up.
 *   - Staff who have it enter a code, but only for a *destructive* action (a ban, a refund, a
 *     payout, a deletion; see `DESTRUCTIVE_STAFF_PERMISSIONS`). The code unlocks the session for a
 *     few minutes. Reading, editing and reviewing never ask.
 *
 * Called only once the caller is known to be staff with the permission: the refusals say things
 * ("turn on two-step verification", "enter your code") that aren't for anybody else to hear.
 * The few functions that use `getStaff` directly to decide what to *show* call it themselves
 * before returning anything an administrator would see.
 */
export async function assertStaffAssurance(
  ctx: QueryCtx,
  staff: StaffContext,
  options: { destructive?: boolean } = {},
): Promise<void> {
  const { requireStaffTwoFactor } = await platformSecurity(ctx);
  await requireAdminAssurance(ctx, staff.user._id, {
    mustEnroll: requireStaffTwoFactor,
    why: "platform",
    askForCode: options.destructive === true,
  });
}

/** Record what a staff member did. Call it in the same mutation as the change,
 * so the log and the change are committed together or not at all. */
export async function audit(
  ctx: MutationCtx,
  actorId: Id<"users">,
  action: string,
  target?: { type: string; id: string },
  summary?: string
): Promise<void> {
  await ctx.db.insert("staffAuditLog", {
    actorId,
    action,
    targetType: target?.type,
    targetId: target?.id,
    summary: summary?.slice(0, 500),
    createdAt: Date.now(),
  });
}
