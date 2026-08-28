import type { Doc, Id } from "../_generated/dataModel";

/**
 * Whose birthday it is, and what they get for it.
 *
 * Two questions, one place, because everything that celebrates has to agree:
 * the cake in place of a presence dot, the temporary decoration around the
 * avatar, and the prompt above a friend's composer all have to be true of the
 * same person on the same day.
 *
 * ## Which day
 *
 * A birthday is a *local* date, and the server has no timezone. So there are
 * two ways someone counts as having a birthday right now:
 *
 * 1. They claimed it. Their own client knows local midnight, and
 *    `users.claimBirthday` stamps `birthdayUntil` with the end of their day.
 *    This is the accurate one, and the only one that can be right for a user
 *    fourteen hours off UTC.
 * 2. The UTC date matches their `dob`'s day and month. The fallback, so a
 *    friend still sees the cake on someone who hasn't opened the app that day
 *    — nobody should have to log in to have a birthday.
 *
 * The two overlap rather than conflict: the union is at most a couple of days
 * wide in the worst timezone, and erring towards a longer birthday is the
 * right way to be wrong about this.
 */

/** `[month, day]` from a `YYYY-MM-DD` date of birth, or null if it isn't one.
 * `updateProfileExtended` validates the shape on write; this is what happens
 * to rows written before it did. */
function monthDay(dob: string | undefined): [number, number] | null {
  if (!dob) return null;
  const [, month, day] = dob.split("-");
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  return [m, d];
}

/** Whether `dob`'s day and month are today's, by the UTC clock. */
function isBirthdayInUtc(dob: string | undefined, now: number): boolean {
  const parsed = monthDay(dob);
  if (!parsed) return false;
  const today = new Date(now);
  return parsed[0] === today.getUTCMonth() + 1 && parsed[1] === today.getUTCDate();
}

/** The subset of a user this module needs, so callers can pass a full document
 * or the handful of fields a merged profile kept. */
type BirthdayFields = Pick<Doc<"users">, "dob" | "birthdayUntil">;

/**
 * Is it this user's birthday, as far as anyone can tell from here?
 *
 * See the note above for why "as far as anyone can tell" is the honest way to
 * put it.
 */
export function isBirthdayNow(
  user: BirthdayFields | null | undefined,
  now: number = Date.now()
): boolean {
  if (!user) return false;
  if (user.birthdayUntil !== undefined && user.birthdayUntil > now) return true;
  return isBirthdayInUtc(user.dob, now);
}

/**
 * The decoration to draw around this user's avatar right now.
 *
 * The birthday one wins while it lasts. It's a gift and it's over by tomorrow,
 * so overriding a decoration the user chose costs them nothing and is the only
 * way the gift is actually seen; their own choice is untouched underneath and
 * comes back on its own.
 */
export function effectiveDecoration(
  user:
    | (BirthdayFields & Pick<Doc<"users">, "avatarDecoration" | "birthdayDecoration">)
    | null
    | undefined,
  now: number = Date.now()
): string | undefined {
  if (!user) return undefined;
  if (isBirthdayNow(user, now)) {
    return user.birthdayDecoration ?? generateBirthdayDecoration(user as Doc<"users">);
  }
  return user.avatarDecoration;
}

/**
 * Generate the birthday decoration for a user: a `birthday:<a>-<b>` value
 * naming the two hues it's drawn in (see src/lib/avatar-decorations.ts, which
 * draws it).
 *
 * Seeded from the user's id and the year, so it's the same frame all day and
 * for everyone looking at them, but a different one next birthday. Derived
 * rather than random because a decoration that changed colour every time the
 * mutation ran would look like a bug.
 */
export function generateBirthdayDecoration(
  user: { _id: Id<"users">; _creationTime: number },
  now: number = Date.now()
): string {
  const seedText = `${user._id}:${new Date(now).getUTCFullYear()}`;
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) {
    seed = (seed * 31 + seedText.charCodeAt(i)) % 100_000;
  }
  const hueA = seed % 360;
  // A second hue a good distance round the wheel, so the pair always reads as
  // two colours rather than two shades of one.
  const hueB = (hueA + 120 + (seed % 90)) % 360;
  return `birthday:${hueA}-${hueB}`;
}

/** Longest a claimed birthday may run for. A day, plus the slack a client an
 * hour out of step with us needs — and no more, so a bad `expiresAt` can't
 * hand someone a permanent cake. */
export const MAX_BIRTHDAY_WINDOW_MS = 26 * 60 * 60 * 1000;

/**
 * Whether a client's claim that it's their user's birthday is plausible.
 *
 * The client is the only one who knows its timezone, so it's trusted for
 * *which hour* the day ends — but not for whether the day is today. The stored
 * `dob` has to be within a day of the UTC date either way, which is as far
 * apart as any real timezone can put them.
 */
export function isPlausibleBirthdayClaim(dob: string | undefined, now: number): boolean {
  const DAY = 24 * 60 * 60 * 1000;
  return (
    isBirthdayInUtc(dob, now - DAY) ||
    isBirthdayInUtc(dob, now) ||
    isBirthdayInUtc(dob, now + DAY)
  );
}
