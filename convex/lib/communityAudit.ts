import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type AuditAction, categoryOf, clipDetails, clipName } from "./communityAuditActions";

/** What an action was done to: a member, a role, a channel… `name` is kept so the row still reads after the thing is deleted. */
export interface AuditTarget {
  type: "user" | "role" | "channel" | "category" | "emoji" | "sound" | "message" | "community" | "invite";
  id?: string;
  name?: string;
}

/**
 * Record something done in a community, for its audit log (`communityAuditLog`, read by people
 * with View Audit Log). Call it from the mutation that did the thing, after the permission check
 * and in the same transaction, so a change that is refused or rolled back leaves no row.
 *
 * `details` is for what changed — never the content of a message. Staff actions on the platform
 * go to `staffAuditLog` instead; this one is the community's own.
 */
export async function logCommunityAudit(
  ctx: MutationCtx,
  entry: {
    communityId: Id<"communities">;
    actorId: Id<"users">;
    action: AuditAction;
    target?: AuditTarget;
    details?: string;
  },
): Promise<void> {
  await ctx.db.insert("communityAuditLog", {
    communityId: entry.communityId,
    actorId: entry.actorId,
    action: entry.action,
    category: categoryOf(entry.action),
    targetType: entry.target?.type,
    targetId: entry.target?.id,
    targetName: clipName(entry.target?.name),
    details: clipDetails(entry.details),
    createdAt: Date.now(),
  });
}

/** A member as an audit target, named as people know them (their display name), looked up here so callers needn't. */
export async function auditUserTarget(ctx: MutationCtx, userId: Id<"users">): Promise<AuditTarget> {
  const user = await ctx.db.get(userId);
  return { type: "user", id: userId, name: user?.name };
}
