import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * What a user owns, and the rules for owning it.
 *
 * One place writes entitlements — a purchase, a subscription renewal and a staff
 * comp all come through here — so "does this person own that" has one answer.
 */

type Grant = { kind: string; payload?: string; label?: string };

/** An entitlement that is currently in force. */
export function isActive(entitlement: Doc<"entitlements">, now = Date.now()): boolean {
  if (entitlement.revokedAt !== undefined) return false;
  if (entitlement.expiresAt !== undefined && entitlement.expiresAt <= now) return false;
  return true;
}

/**
 * Whether the user already has this SKU.
 *
 * For a community item the question is per community: the same theme can be
 * bought for two different servers.
 */
export async function ownsSku(
  ctx: QueryCtx,
  userId: Id<"users">,
  skuId: Id<"skus">,
  communityId?: Id<"communities">
): Promise<boolean> {
  const rows = await ctx.db
    .query("entitlements")
    .withIndex("by_user_sku", (q) => q.eq("userId", userId).eq("skuId", skuId))
    .collect();
  return rows.some((e) => isActive(e) && (communityId === undefined || e.communityId === communityId));
}

/** Give a user what a SKU grants. Idempotent per order, so a webhook that is
 * delivered twice does not give it twice. */
export async function grantEntitlements(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    skuId: Id<"skus">;
    grants: Grant[];
    source: Doc<"entitlements">["source"];
    orderId?: Id<"orders">;
    communityId?: Id<"communities">;
    expiresAt?: number;
  }
): Promise<number> {
  if (args.orderId) {
    const already = await ctx.db
      .query("entitlements")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .first();
    if (already) return 0;
  }
  const now = Date.now();
  for (const grant of args.grants) {
    await ctx.db.insert("entitlements", {
      userId: args.userId,
      skuId: args.skuId,
      kind: grant.kind,
      payload: grant.payload,
      label: grant.label,
      communityId: args.communityId,
      source: args.source,
      orderId: args.orderId,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
  }
  return args.grants.length;
}

/** Take back everything an order gave. */
export async function revokeOrderEntitlements(ctx: MutationCtx, orderId: Id<"orders">): Promise<void> {
  const rows = await ctx.db
    .query("entitlements")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .collect();
  const now = Date.now();
  for (const row of rows) {
    if (row.revokedAt === undefined) await ctx.db.patch(row._id, { revokedAt: now });
  }
}

/** Set when a subscription's entitlements run out — to the end of what has been
 * paid for, each time it is paid. */
export async function setOrderEntitlementExpiry(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  expiresAt: number
): Promise<void> {
  const rows = await ctx.db
    .query("entitlements")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .collect();
  for (const row of rows) {
    if (row.revokedAt === undefined) await ctx.db.patch(row._id, { expiresAt });
  }
}
