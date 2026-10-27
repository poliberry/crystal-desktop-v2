import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ABILITY_REFUSALS, normalizeAbilities, type Ability } from "./abilities";

/**
 * Where staff decisions about accounts and communities are *enforced*.
 *
 * The console records a suspension, a ban, a limit or a community's status; these
 * are what make it mean something. Kept in one file so "what does suspended stop?"
 * has one answer, rather than being whichever mutations remembered to ask.
 *
 *   suspended  signs in, reads, can do nothing (every mutation refuses)
 *   limited    signs in and carries on, minus the abilities listed on the account
 *   banned     can't do anything or read anything, and its addresses can't open
 *              new accounts. Lasts until staff lift it.
 */

/** A suspension with no end date. A real timestamp, so it compares like any
 * other and an absent value can keep meaning "not suspended". */
export const INDEFINITE = 8_640_000_000_000_000;

/** The suspension on a user, if one is in force. */
export function activeSuspension(
  user: Pick<Doc<"users">, "platformSuspendedUntil" | "platformSuspensionReason">,
  now = Date.now(),
): { until: number; indefinite: boolean; reason?: string } | null {
  const until = user.platformSuspendedUntil;
  if (until === undefined || until <= now) return null;
  return { until, indefinite: until >= INDEFINITE, reason: user.platformSuspensionReason };
}

/** The ban on a user, if there is one. */
export function activeBan(
  user: Pick<Doc<"users">, "platformBannedAt" | "platformBanReason">,
): { at: number; reason?: string } | null {
  if (user.platformBannedAt === undefined) return null;
  return { at: user.platformBannedAt, reason: user.platformBanReason };
}

/** Why an account can't sign in, as the sign-in screen shows it. */
export type SignInBlock =
  | { kind: "banned"; reason?: string }
  | { kind: "suspended"; reason?: string; until: number; indefinite: boolean };

/**
 * Whether this account is allowed to start a session at all, and if not, why.
 *
 * The one answer to "can they sign in?": a ban, or a suspension that hasn't run out. It is asked
 * after the password has been checked and before anything else is offered, so a blocked person
 * is told so straight away rather than after a second-step prompt, and nobody who hasn't proved
 * who they are learns anything about an account's standing.
 */
export function signInBlock(
  user: Pick<
    Doc<"users">,
    "platformBannedAt" | "platformBanReason" | "platformSuspendedUntil" | "platformSuspensionReason"
  >,
  now = Date.now(),
): SignInBlock | null {
  const ban = activeBan(user);
  if (ban) return { kind: "banned", reason: ban.reason };
  const suspension = activeSuspension(user, now);
  if (suspension) {
    return { kind: "suspended", reason: suspension.reason, until: suspension.until, indefinite: suspension.indefinite };
  }
  return null;
}

/** The same decision as a sentence, for the places that can only throw an `Error`. */
export function signInBlockMessage(block: SignInBlock): string {
  if (block.kind === "banned") return "Your account has been banned.";
  return block.indefinite
    ? "Your account is suspended."
    : `Your account is suspended until ${new Date(block.until).toDateString()}.`;
}

/** The limits on a user that are in force: which abilities, and until when
 * (`null` for until lifted). */
export function activeLimits(
  user: Pick<Doc<"users">, "platformLimits" | "platformLimitedUntil" | "platformLimitReason">,
  now = Date.now(),
): { abilities: Ability[]; until: number | null; reason?: string } | null {
  const abilities = normalizeAbilities(user.platformLimits ?? []);
  if (abilities.length === 0) return null;
  const until = user.platformLimitedUntil;
  if (until !== undefined && until <= now) return null;
  return { abilities, until: until ?? null, reason: user.platformLimitReason };
}

/** Refuse `ability` if staff have taken it away from this account. */
export function requireAbility(
  user: Pick<Doc<"users">, "platformLimits" | "platformLimitedUntil" | "platformLimitReason">,
  ability: Ability,
): void {
  const limits = activeLimits(user);
  if (!limits || !limits.abilities.includes(ability)) return;
  const when = limits.until === null ? "" : ` until ${new Date(limits.until).toDateString()}`;
  throw new Error(`Crystal staff have limited your account: you can't ${ABILITY_REFUSALS[ability]}${when}.`);
}

/** The state of a community's staff status once expiry is taken into account. */
export function effectiveCommunityStatus(
  moderation: Pick<Doc<"communityModeration">, "status" | "until"> | null,
  now = Date.now(),
): Doc<"communityModeration">["status"] {
  if (!moderation) return "active";
  if (moderation.status === "suspended" && moderation.until !== undefined && moderation.until <= now) return "active";
  return moderation.status;
}

/** What a community's status stops. `restricted` closes the door to newcomers;
 * `archived` also makes it read-only; `suspended` and `banned` close it entirely,
 * the first for a while and the second for good. */
export async function requireCommunityOpen(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  action: "join" | "post",
): Promise<void> {
  const moderation = await ctx.db
    .query("communityModeration")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .unique();
  const status = effectiveCommunityStatus(moderation);
  if (status === "active") return;
  if (status === "banned") throw new Error("This community has been banned by Crystal staff.");
  if (status === "suspended") throw new Error("This community has been suspended by Crystal staff.");
  if (status === "archived") throw new Error("This community has been archived by Crystal staff.");
  if (action === "join") throw new Error("This community isn't accepting new members right now.");
}
