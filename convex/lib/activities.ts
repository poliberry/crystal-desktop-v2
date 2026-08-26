import type { Doc } from "../_generated/dataModel";

type Activity = NonNullable<Doc<"presence">["activities"]>[number];

/**
 * Read a presence row's Rich Presence activities.
 *
 * Presence used to hold a single `activity`; it now holds an ordered
 * `activities` list so a user can be playing something *and* listening to
 * something. Rows written before that change still carry the old field — and
 * removing it from the schema would make those rows fail validation on the
 * next push — so it stays as a deprecated fallback and everything reads
 * through here instead of touching either field directly.
 */
export function activitiesOf(presence: Doc<"presence"> | null | undefined) {
  if (!presence) return [];
  if (presence.activities?.length) return presence.activities;
  return presence.activity ? [presence.activity] : [];
}

/** Whether a "clear after…" deadline has passed. Absent means "never". */
function expired(expiresAt: number | undefined, now: number): boolean {
  return expiresAt !== undefined && expiresAt <= now;
}

/**
 * The user's own custom activity, if they have one that hasn't run out.
 *
 * Expiry is enforced here rather than only by the sweep so a lapsed activity
 * disappears on the stroke of its deadline, not at whatever point something
 * next writes to the row.
 */
export function customActivityOf(
  user: Doc<"users"> | null | undefined,
  now: number = Date.now()
): Activity | null {
  if (!user?.customActivity) return null;
  if (expired(user.customActivityExpiresAt, now)) return null;
  return user.customActivity;
}

/**
 * Everything to show for a user, richest first.
 *
 * A custom activity leads: the user said it explicitly, which outranks
 * anything we inferred from their process list.
 *
 * Nothing is shown for someone offline. That includes invisible, which is the
 * whole point of it — the status picker promises that your activity stays
 * private, and a custom activity outliving the session it was set in would
 * otherwise keep announcing you.
 */
export function visibleActivities(
  presence: Doc<"presence"> | null | undefined,
  user: Doc<"users"> | null | undefined,
  now: number = Date.now()
): Activity[] {
  if (!presence || presence.effective === "offline") return [];
  const custom = customActivityOf(user, now);
  const detected = activitiesOf(presence);
  return custom ? [custom, ...detected] : detected;
}

/**
 * A custom status with only its deadline applied.
 *
 * For the places that carry a user without their presence row — message
 * authors, say — where reading presence per row would cost more than the
 * offline rule is worth. Prefer `visibleCustomStatus` wherever presence is
 * already in hand.
 */
export function unexpiredCustomStatus(
  user: Doc<"users"> | null | undefined,
  now: number = Date.now()
): string | undefined {
  if (!user?.customStatus) return undefined;
  return expired(user.customStatusExpiresAt, now) ? undefined : user.customStatus;
}

/**
 * A custom status, as viewers should see it.
 *
 * Two things hide one: it ran out, or the user is offline. Offline includes
 * invisible, and the stored text is deliberately left alone in both cases —
 * "Back Monday" is exactly the kind of note that should still be there when
 * they come back, so this is a display rule rather than a deletion.
 *
 * `override` is a per-community status from a server profile, which takes the
 * global one's place but follows the same rules.
 */
export function visibleCustomStatus(
  user: Doc<"users"> | null | undefined,
  status: string,
  override?: string,
  now: number = Date.now()
): string | undefined {
  if (status === "offline") return undefined;
  if (override) return override;
  if (!user?.customStatus) return undefined;
  return expired(user.customStatusExpiresAt, now) ? undefined : user.customStatus;
}
