import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCurrentUserOrNull } from "../users";
import { can, type StaffPermission, type StaffRole } from "./staffPermissions";

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
  permission: StaffPermission
): Promise<StaffContext> {
  const staff = await getStaff(ctx);
  if (!staff || !can(staff.roles, permission)) throw new Error("Not allowed.");
  return staff;
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
