/**
 * What a person's status can be, and what each one is called.
 *
 * Six of them rather than the four this started with, because "online" was
 * carrying too much: someone at their desk, someone who wandered off, someone
 * who left the room and someone who is here but does not want to be
 * interrupted are four different answers to "can I talk to you", and every
 * messenger that has ever worked has said so. See issue #101.
 *
 *   active     using Crystal right now
 *   idle       online, but not touching it
 *   away       away from the machine, or it is locked
 *   dnd        interruptions suppressed, by choice
 *   busy       interruptions suppressed, because something else has them
 *   invisible  online and saying otherwise
 *
 * `online` is still the key for the active state. Renaming it would mean
 * migrating every presence row and every member list in flight to say the same
 * thing in different letters; the label is where the word lives.
 */
export type ManualStatus = "online" | "idle" | "away" | "dnd" | "busy" | "invisible";

/** What you see for yourself: `invisible` stays, rather than collapsing to
 * offline the way everybody else sees it. */
export type DisplayStatus = "online" | "idle" | "away" | "dnd" | "busy" | "invisible";

/** What you see for somebody else, where invisible is indistinguishable from
 * offline — which is the entire point of it. */
export type FriendStatus = "online" | "idle" | "away" | "dnd" | "busy" | "offline";

/** Mirrors the server's `computeEffective`, but keeps "invisible" for self
 * display instead of collapsing it to "offline". */
export function displayStatus(manualStatus: ManualStatus, isIdle: boolean): DisplayStatus {
  // Everything chosen deliberately outranks the idle timer: someone who marked
  // themselves busy and then stopped typing is still busy, not idle.
  if (manualStatus !== "online") return manualStatus;
  return isIdle ? "idle" : "online";
}

export const STATUS_LABEL: Record<DisplayStatus | FriendStatus, string> = {
  online: "Active",
  idle: "Idle",
  away: "Away",
  dnd: "Do Not Disturb",
  busy: "Busy",
  invisible: "Invisible",
  offline: "Offline",
};

/**
 * The colour each status is drawn in — the palette from issue #101, as hex
 * rather than as Tailwind classes.
 *
 * Hex because these are not theme colours: a status colour means the same
 * thing in every theme, and half of them (a pure yellow, a pure red) have no
 * near-enough equivalent in the palette. They are also handed straight to an
 * SVG `fill`, which cannot take a class.
 */
export const STATUS_COLOR: Record<DisplayStatus | FriendStatus, string> = {
  online: "#00b92f",
  idle: "#ff8000",
  away: "#ffff00",
  dnd: "#ff0000",
  busy: "#ff0000",
  invisible: "#c0c0c0",
  offline: "#c0c0c0",
};

/** The colour an activity glyph is drawn in, when one replaces the status —
 * see `PresenceDot`. */
export const ACTIVITY_COLOR = {
  playing: "#00ffff",
  listening: "#ff0080",
  watching: "#8000ff",
  streaming: "#8000ff",
} as const;

/** Every status somebody can put themselves in, in the order they are offered.
 * Reachable first, suppressed second, hidden last. */
export const MANUAL_STATUSES: ManualStatus[] = [
  "online",
  "idle",
  "away",
  "dnd",
  "busy",
  "invisible",
];

/** One line on what each one means, for the pickers. */
export const STATUS_HINT: Record<ManualStatus, string> = {
  online: "Visible to everyone.",
  idle: "Online, but not at your keyboard.",
  away: "Away from your device.",
  dnd: "Notifications are suppressed.",
  busy: "Notifications are suppressed while something else has your attention.",
  invisible: "You'll appear offline, and your activity stays private.",
};
