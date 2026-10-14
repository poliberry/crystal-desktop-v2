import type { Doc } from "../_generated/dataModel";
import type { Ability } from "./abilities";

/**
 * Guest accounts: a username and nothing else, to try the app for a day.
 *
 * A guest has no address and no password, so there is nothing to recover and no second step to
 * add; it is a real `users` row, though, so everything that works for an account works for it, and
 * the rules below are the only difference. When it runs out it is wiped down to a placeholder
 * (convex/guests.ts) rather than deleted, because what it said and did still points at it.
 */

/** How long a guest account lasts. */
export const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Guest accounts one network may make in a day, and every network together may make in an hour. */
export const GUESTS_PER_NETWORK_PER_DAY = 3;
export const GUESTS_PER_HOUR = 300;

/**
 * What a guest can't do. They can look around, join communities, message and talk — enough to
 * judge the app — but not leave anything lasting or reach people who didn't come to them:
 * no communities of their own, no uploads, no friend requests.
 */
export const GUEST_BLOCKED: readonly Ability[] = ["create_communities", "upload_media", "friend_requests"];

export const GUEST_REFUSALS: Record<string, string> = {
  create_communities: "start a community",
  upload_media: "upload files",
  friend_requests: "send friend requests",
};

type GuestFields = Pick<Doc<"users">, "isGuest" | "guestExpiresAt">;

export function isGuest(user: GuestFields): boolean {
  return user.isGuest === true;
}

/** A guest whose day is up (or whose expiry was cleared by the sweep): it can no longer be used. */
export function guestExpired(user: GuestFields, now = Date.now()): boolean {
  return user.isGuest === true && (user.guestExpiresAt === undefined || user.guestExpiresAt <= now);
}

/** Refuse `ability` to a guest, in words that say how to get it. */
export function requireNotGuestFor(user: GuestFields, ability: Ability): void {
  if (user.isGuest === true && GUEST_BLOCKED.includes(ability)) {
    throw new Error(`Guest accounts can't ${GUEST_REFUSALS[ability] ?? "do that"}. Create a free account to unlock it.`);
  }
}
