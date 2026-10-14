import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { AUTH_ERROR } from "./authPolicy";
import { signedInIds } from "./identity";
import { factorSummary } from "./secondFactor";
import { STEP_UP_TTL_MS } from "./twoFactor";

/**
 * Two-step verification for administrative functions.
 *
 * Two separate rules, because they answer different questions:
 *
 *   enrolment  "this role needs two-step verification switched on". Set by the platform for
 *              staff and by each server for its admins. Someone without it is refused, told
 *              why, and pointed at Settings → Security.
 *
 *   step-up    "this person has two-step verification, so prove it's still them". Whoever has
 *              it switched on enters a code (or uses a passkey) before an administrative
 *              function; that unlocks the *session* for `STEP_UP_TTL_MS`, not the account, so
 *              a second device or a copied session token doesn't inherit it.
 *
 * Both are enforced here, on the server, from the places every administrative function already
 * goes through (`requireStaff`, `requireCommunityPermission`). Nothing in the app can skip them
 * by not asking.
 */

/** The server-wide security settings. Absent row means every requirement is off. */
export async function platformSecurity(ctx: QueryCtx): Promise<{ requireStaffTwoFactor: boolean }> {
  const row = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "security")).unique();
  return { requireStaffTwoFactor: row?.requireStaffTwoFactor ?? false };
}

/** Whether this session has entered a second step recently, and until when. */
export async function stepUpState(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<{ enrolled: boolean; unlockedUntil: number | null }> {
  const [factors, ids] = await Promise.all([factorSummary(ctx, userId), signedInIds(ctx)]);
  if (!ids || ids.userId !== userId) return { enrolled: factors.enrolled, unlockedUntil: null };
  const grants = await ctx.db.query("stepUpGrants").withIndex("by_session", (q) => q.eq("sessionId", ids.sessionId)).collect();
  const now = Date.now();
  // A password confirmation proves nothing a session didn't already; it never counts here.
  const live = grants.filter((g) => g.expiresAt > now && g.method !== "password");
  const unlockedUntil = live.length ? Math.max(...live.map((g) => g.expiresAt)) : null;
  return { enrolled: factors.enrolled, unlockedUntil };
}

/** Record that the signed-in session just entered a valid second step. */
export async function grantStepUp(
  ctx: MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"authSessions">,
  method: Doc<"stepUpGrants">["method"],
): Promise<number> {
  const old = await ctx.db.query("stepUpGrants").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect();
  for (const row of old) await ctx.db.delete(row._id);
  const expiresAt = Date.now() + STEP_UP_TTL_MS;
  await ctx.db.insert("stepUpGrants", { sessionId, userId, method, expiresAt });
  return expiresAt;
}

/**
 * Refuse an administrative function unless the caller's session may perform it.
 *
 * `mustEnroll` is the "this role requires two-step verification" rule; `why` names whose rule it
 * is in the message. `askForCode` is whether this particular call is one that needs a fresh code
 * from someone who has two-step verification: it is for destructive actions only (see
 * `DESTRUCTIVE_STAFF_PERMISSIONS`), so everything else an administrator does goes through without
 * interrupting them. The enrolment rule is independent of it and applies to every call. Throws a
 * `ConvexError` carrying a code the app switches on: the client turns `STEP_UP_REQUIRED` into a
 * prompt and retries, and `TWO_FACTOR_REQUIRED` into a pointer at Settings → Security.
 */
export async function requireAdminAssurance(
  ctx: QueryCtx,
  userId: Id<"users">,
  options: { mustEnroll: boolean; why: "platform" | "server"; askForCode: boolean },
): Promise<void> {
  const state = await stepUpState(ctx, userId);
  if (!state.enrolled) {
    if (!options.mustEnroll) return;
    throw new ConvexError({
      code: AUTH_ERROR.twoFactorRequired,
      scope: options.why,
      message:
        options.why === "platform"
          ? "Crystal requires two-step verification on staff accounts. Turn it on in Settings → Security."
          : "This server requires two-step verification to manage it. Turn it on in Settings → Security.",
    });
  }
  if (!options.askForCode) return;
  if (state.unlockedUntil !== null && state.unlockedUntil > Date.now()) return;
  throw new ConvexError({
    code: AUTH_ERROR.stepUpRequired,
    message: "Enter a verification code to continue.",
  });
}

/**
 * Refuse a change to an account's own security settings (adding or removing a factor, replacing
 * the password) unless the session has just proved it's the owner at the keyboard: with a code
 * if the account has a second step, or by typing the password if it has none yet. A stolen
 * session token on its own can't lock the real owner out by enrolling its own authenticator.
 */
export async function requireFreshVerification(ctx: QueryCtx, userId: Id<"users">): Promise<void> {
  const state = await stepUpState(ctx, userId);
  const now = Date.now();
  if (state.enrolled) {
    if (state.unlockedUntil !== null && state.unlockedUntil > now) return;
    throw new ConvexError({ code: AUTH_ERROR.stepUpRequired, message: "Enter a verification code to continue." });
  }
  const ids = await signedInIds(ctx);
  const grants = ids
    ? await ctx.db.query("stepUpGrants").withIndex("by_session", (q) => q.eq("sessionId", ids.sessionId)).collect()
    : [];
  if (grants.some((g) => g.method === "password" && g.expiresAt > now)) return;
  throw new ConvexError({ code: AUTH_ERROR.passwordRequired, message: "Confirm your password to continue." });
}

/** Whether this is a mutation's context. A query can't be retried with a code typed in the middle of it. */
export function isMutationCtx(ctx: QueryCtx): ctx is MutationCtx {
  return "scheduler" in ctx;
}
