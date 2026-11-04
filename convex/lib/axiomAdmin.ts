import { v } from "convex/values";

import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import * as accountDeletion from "../accountDeletion";
import * as badges from "../badges";
import * as bannedWords from "../bannedWords";
import * as catalog from "../catalog";
import * as guests from "../guests";
import * as marketplace from "../marketplace";
import * as operations from "../operations";
import * as reports from "../reports";
import * as staff from "../staff";
import * as support from "../support";
import type { AxiomActor } from "./axiomActor";
import { audit } from "./staff";

/**
 * The Admin Console functions Axiom's Crystal Moderation app may run, by name. They are the
 * console's own functions, so a ban from Axiom revokes sessions and bans networks exactly as a ban
 * from the console does. Anything not listed here can't be reached from Axiom.
 *
 * A function marked `changeRequest` runs only with a `CR-` reference: a request a second operator
 * approved in Axiom. Everything else carries the `MA-` ledger reference of a single operator's action.
 */
type Registered = { _handler: (ctx: never, args: never) => unknown; exportArgs: () => string };
const fn = (f: unknown) => f as Registered;

const READS: Record<string, Registered> = {
  overview: fn(operations.overview),
  search: fn(operations.search),
  users: fn(operations.users),
  userDetail: fn(operations.userDetail),
  communities: fn(operations.communities),
  communityDetail: fn(operations.communityDetail),
  badges: fn(badges.adminCatalogue),
  "reports.counts": fn(reports.adminCounts),
  "reports.list": fn(reports.adminList),
  "reports.get": fn(reports.adminGet),
  "support.list": fn(support.adminList),
  "support.get": fn(support.adminGet),
  "catalog.categories": fn(catalog.adminCategories),
  "catalog.skus": fn(catalog.adminListSkus),
  "catalog.sku": fn(catalog.adminGetSku),
  "submissions.list": fn(marketplace.adminSubmissions),
  "submissions.get": fn(marketplace.adminSubmission),
  audit: fn(staff.auditLog),
  "bannedWords.list": fn(bannedWords.list),
  "bannedWords.test": fn(bannedWords.test),
  "guests.overview": fn(guests.adminGuestOverview),
  "users.deletionCheck": fn(accountDeletion.adminDeletionCheck),
};

const WRITES: Record<string, { fn: Registered; changeRequest?: (input: Record<string, unknown>) => boolean }> = {
  "users.ban": { fn: fn(operations.banUser), changeRequest: () => true },
  "users.unban": { fn: fn(operations.unbanUser) },
  "users.suspend": { fn: fn(operations.suspendUser) },
  "users.unsuspend": { fn: fn(operations.unsuspendUser) },
  "users.limit": { fn: fn(operations.limitUser) },
  "users.unlimit": { fn: fn(operations.unlimitUser) },
  "users.badge": { fn: fn(operations.setUserBadge) },
  "users.grantSku": { fn: fn(operations.grantSku) },
  "users.revokeEntitlement": { fn: fn(operations.revokeEntitlement) },
  "communities.setStatus": { fn: fn(operations.setCommunityStatus), changeRequest: (input) => input.status === "banned" },
  "reports.claim": { fn: fn(reports.adminClaim) },
  "reports.setStatus": { fn: fn(reports.adminSetStatus) },
  "reports.addNote": { fn: fn(reports.adminAddNote) },
  "reports.messageReporter": { fn: fn(reports.adminMessageReporter) },
  "support.assign": { fn: fn(support.adminAssign) },
  "support.create": { fn: fn(support.adminCreate) },
  "support.reply": { fn: fn(support.adminReply) },
  "support.setStatus": { fn: fn(support.adminSetStatus) },
  "catalog.upsertSku": { fn: fn(catalog.adminUpsertSku) },
  "catalog.upsertCategory": { fn: fn(catalog.adminUpsertCategory) },
  "catalog.deleteCategory": { fn: fn(catalog.adminDeleteCategory), changeRequest: () => true },
  "submissions.approve": { fn: fn(marketplace.adminApproveSubmission) },
  "submissions.reject": { fn: fn(marketplace.adminRejectSubmission) },
  "bannedWords.add": { fn: fn(bannedWords.add) },
  "bannedWords.update": { fn: fn(bannedWords.update) },
  "bannedWords.remove": { fn: fn(bannedWords.remove) },
  "bannedWords.seed": { fn: fn(bannedWords.seedDefaults) },
  "guests.purgeExpired": { fn: fn(guests.adminPurgeExpiredGuests) },
  "users.delete": { fn: fn(accountDeletion.adminDeleteAccount), changeRequest: () => true },
};

// ── argument checking ───────────────────────────────────────────────────────────────────────────
// Calling a handler directly skips Convex's validation, so the function's own validator is applied.

type Json = { type: string; value?: unknown; tableName?: string; keys?: Json; values?: { fieldType: Json } };

function conforms(ctx: QueryCtx, s: Json, x: unknown): boolean {
  switch (s.type) {
    case "any":
      return true;
    case "null":
      return x === null;
    case "string":
      return typeof x === "string";
    case "number":
      return typeof x === "number";
    case "boolean":
      return typeof x === "boolean";
    case "id":
      return typeof x === "string" && ctx.db.normalizeId(s.tableName as never, x) !== null;
    case "literal":
      return x === s.value;
    case "array":
      return Array.isArray(x) && x.every((e) => conforms(ctx, s.value as Json, e));
    case "union":
      return (s.value as Json[]).some((o) => conforms(ctx, o, x));
    case "record":
      return typeof x === "object" && x !== null && !Array.isArray(x) && Object.values(x).every((e) => conforms(ctx, s.values!.fieldType, e));
    case "object": {
      if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
      const fields = s.value as Record<string, { fieldType: Json; optional: boolean }>;
      const obj = x as Record<string, unknown>;
      if (Object.keys(obj).some((k) => !(k in fields))) return false;
      return Object.entries(fields).every(([k, f]) => (obj[k] === undefined ? f.optional : conforms(ctx, f.fieldType, obj[k])));
    }
    default:
      return false;
  }
}

function checkInput(ctx: QueryCtx, name: string, f: Registered, input: unknown) {
  if (!conforms(ctx, JSON.parse(f.exportArgs()) as Json, input ?? {})) throw new Error(`Invalid arguments for ${name}.`);
}

// ── running ─────────────────────────────────────────────────────────────────────────────────────

const SECRET_KEY = /secret|cipher|token|password|hash$|^enc$|recoverycode|totp/i;

/** Keeps anything secret-shaped out of what crosses the bridge, whatever a console function returns. */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object" && !(value instanceof ArrayBuffer)) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEY.test(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return value === undefined ? null : value;
}

async function asAxiom<C extends QueryCtx>(ctx: C, operatorSub: string, changeRef?: string) {
  const systemUser = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", "system:crystal"))
    .unique();
  if (!systemUser) throw new Error("Provision the Crystal system account before using Axiom's moderation tools.");
  const actor: AxiomActor = { systemUser, operatorSub, changeRef };
  return { wrapped: { ...ctx, axiomActor: actor } as C, systemUser };
}

export const adminRead = internalQuery({
  args: { name: v.string(), input: v.any(), operatorSub: v.string() },
  handler: async (ctx, { name, input, operatorSub }): Promise<unknown> => {
    const f = Object.hasOwn(READS, name) ? READS[name] : undefined;
    if (!f) throw new Error(`${name} is not exposed to Axiom.`);
    checkInput(ctx, name, f, input);
    const { wrapped } = await asAxiom(ctx, operatorSub);
    return scrub(await f._handler(wrapped as never, (input ?? {}) as never));
  },
});

export const adminWrite = internalMutation({
  args: { name: v.string(), input: v.any(), operatorSub: v.string(), changeRef: v.string() },
  handler: async (ctx: MutationCtx, { name, input, operatorSub, changeRef }): Promise<unknown> => {
    const def = Object.hasOwn(WRITES, name) ? WRITES[name] : undefined;
    if (!def) throw new Error(`${name} is not exposed to Axiom.`);
    checkInput(ctx, name, def.fn, input);
    const needsApproval = def.changeRequest?.((input ?? {}) as Record<string, unknown>) ?? false;
    if (needsApproval && !changeRef.startsWith("CR-")) throw new Error(`${name} is not allowed without an approved change request.`);
    const { wrapped, systemUser } = await asAxiom(ctx, operatorSub, changeRef);
    const result = await def.fn._handler(wrapped as never, (input ?? {}) as never);
    // Who really did it. The console function's own entries name the system account.
    await audit(ctx, systemUser._id, `axiom.${name}`, { type: "axiom", id: changeRef }, `${changeRef} by ${operatorSub}`);
    return scrub(result);
  },
});
