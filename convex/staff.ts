import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { audit, getStaff, requireStaff } from "./lib/staff";
import { can, permissionsFor, STAFF_ROLES, type StaffRole } from "./lib/staffPermissions";

const rolesValidator = v.array(
  v.union(
    v.literal("owner"),
    v.literal("admin"),
    v.literal("moderator"),
    v.literal("support"),
    v.literal("finance")
  )
);

/** Roles in a stable order, without repeats. */
const cleanRoles = (roles: StaffRole[]): StaffRole[] =>
  STAFF_ROLES.filter((role) => roles.includes(role));

/**
 * The caller's staff access, or `null` for anyone who isn't staff.
 *
 * What the app asks to decide whether to show the console at all, and what the
 * console asks to decide which sections to show. It tells a non-staff user
 * nothing: `null` is the same for everybody who has no access.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const staff = await getStaff(ctx);
    if (!staff) return null;
    return {
      userId: staff.user._id,
      name: staff.user.name,
      username: staff.user.username,
      imageUrl: staff.user.imageUrl,
      roles: staff.roles,
      permissions: [...permissionsFor(staff.roles)],
    };
  },
});

/** Everyone with staff access, current and revoked. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "staff.manage");
    const rows = await ctx.db.query("staffMembers").collect();
    return Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return {
          id: row._id,
          userId: row.userId,
          name: user?.name ?? "Unknown",
          username: user?.username ?? "unknown",
          imageUrl: user?.imageUrl,
          roles: row.roles as StaffRole[],
          createdAt: row.createdAt,
          revokedAt: row.revokedAt,
        };
      })
    );
  },
});

async function userByUsername(ctx: { db: QueryCtx["db"] }, username: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_username", (q) => q.eq("username", username.trim().toLowerCase().replace(/^@/, "")))
    .unique();
  if (!user) throw new Error(`No user with username "${username}".`);
  return user;
}

/** Taking the owner role off the last owner would leave nobody able to manage
 * staff at all. */
async function assertOwnerRemains(
  ctx: { db: QueryCtx["db"] },
  changingId: Id<"staffMembers">,
  nextRoles: StaffRole[]
) {
  if (nextRoles.includes("owner")) return;
  const all = await ctx.db.query("staffMembers").collect();
  const owners = all.filter(
    (row) =>
      row.revokedAt === undefined &&
      row._id !== changingId &&
      (row.roles as StaffRole[]).includes("owner")
  );
  if (owners.length === 0) throw new Error("There has to be at least one owner.");
}

/** Give someone staff access, or change the roles they have. */
export const grant = mutation({
  args: { username: v.string(), roles: rolesValidator },
  handler: async (ctx, { username, roles }) => {
    const actor = await requireStaff(ctx, "staff.manage");
    const next = cleanRoles(roles as StaffRole[]);
    if (next.length === 0) throw new Error("Pick at least one role.");
    const target = await userByUsername(ctx, username);

    const existing = await ctx.db
      .query("staffMembers")
      .withIndex("by_user", (q) => q.eq("userId", target._id))
      .unique();

    if (existing && existing.revokedAt === undefined) {
      await assertOwnerRemains(ctx, existing._id, next);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        roles: next,
        revokedAt: undefined,
        grantedBy: actor.user._id,
      });
    } else {
      await ctx.db.insert("staffMembers", {
        userId: target._id,
        roles: next,
        grantedBy: actor.user._id,
        createdAt: Date.now(),
      });
    }
    await audit(
      ctx,
      actor.user._id,
      "staff.grant",
      { type: "user", id: target._id },
      `${target.username}: ${next.join(", ")}`
    );
  },
});

/** Take staff access away. Their history stays; their access doesn't. */
export const revoke = mutation({
  args: { staffId: v.id("staffMembers") },
  handler: async (ctx, { staffId }) => {
    const actor = await requireStaff(ctx, "staff.manage");
    const row = await ctx.db.get(staffId);
    if (!row || row.revokedAt !== undefined) return;
    await assertOwnerRemains(ctx, staffId, []);
    await ctx.db.patch(staffId, { revokedAt: Date.now() });
    const user = await ctx.db.get(row.userId);
    await audit(ctx, actor.user._id, "staff.revoke", { type: "user", id: row.userId }, user?.username);
  },
});

/**
 * The first owner.
 *
 * Run by hand — `npx convex run staff:bootstrap '{"username":"…"}'` — because
 * there is nobody to grant the first role. Internal, so it is not callable from
 * the app. Finance is not part of it: an owner grants that, on the record, to
 * whoever should have it.
 */
export const bootstrap = internalMutation({
  args: { username: v.string(), roles: v.optional(rolesValidator) },
  handler: async (ctx, { username, roles }) => {
    const target = await userByUsername(ctx, username);
    const next = cleanRoles((roles ?? ["owner"]) as StaffRole[]);
    const existing = await ctx.db
      .query("staffMembers")
      .withIndex("by_user", (q) => q.eq("userId", target._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { roles: next, revokedAt: undefined });
    } else {
      await ctx.db.insert("staffMembers", {
        userId: target._id,
        roles: next,
        createdAt: Date.now(),
      });
    }
    await audit(ctx, target._id, "staff.bootstrap", { type: "user", id: target._id }, next.join(", "));
    return { username: target.username, roles: next };
  },
});

/**
 * Recent staff actions, newest first.
 *
 * Finance entries are only returned to whoever may see finance, so the log
 * doesn't leak what the finance section keeps locked.
 */
export const auditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const staff = await requireStaff(ctx, "audit.read");
    const seesFinance = can(staff.roles, "finance.read");
    const cap = Math.min(Math.max(limit ?? 100, 1), 200);
    const rows = await ctx.db
      .query("staffAuditLog")
      .withIndex("by_created")
      .order("desc")
      .take(cap * 2);
    const visible = rows.filter((row) => seesFinance || !row.action.startsWith("finance."));
    return Promise.all(
      visible.slice(0, cap).map(async (row) => {
        const actor = await ctx.db.get(row.actorId);
        return {
          id: row._id,
          action: row.action,
          actor: actor?.username ?? "unknown",
          targetType: row.targetType,
          targetId: row.targetId,
          summary: row.summary,
          createdAt: row.createdAt,
        };
      })
    );
  },
});
