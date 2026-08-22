import type { Doc } from "../_generated/dataModel";

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
