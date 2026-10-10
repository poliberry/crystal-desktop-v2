/** The kinds of activity the bot can show, as in "Playing …". */
export const ActivityType = { Playing: "playing", Listening: "listening", Watching: "watching", Streaming: "streaming" } as const;
/** One of the values of `ActivityType`. */
export type ActivityTypeName = (typeof ActivityType)[keyof typeof ActivityType];
/** How the bot is shown: online, idle, do not disturb, or invisible. */
export type StatusName = "online" | "idle" | "dnd" | "invisible";

/** What the bot is shown doing. */
export interface ActivityOptions {
  /** The kind of activity. */
  type: ActivityTypeName;
  /** What it is: the game, song or show. */
  name: string;
  /** A second line. */
  details?: string;
  /** A third line. */
  state?: string;
}

/** How the bot is shown to others. */
export interface PresenceOptions {
  /** Online, idle, do not disturb or invisible. */
  status?: StatusName;
  /** What it is doing. */
  activities?: ActivityOptions[];
  /** A line shown under the bot's name. `null` clears it. */
  customStatus?: string | null;
}
