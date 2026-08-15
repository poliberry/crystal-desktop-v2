export type ManualStatus = "online" | "idle" | "dnd" | "invisible";
export type DisplayStatus = "online" | "dnd" | "idle" | "invisible";
export type FriendStatus = "online" | "dnd" | "idle" | "offline";

/** Mirrors the server's `computeEffective`, but keeps "invisible" for self display instead of collapsing it to "offline". */
export function displayStatus(manualStatus: ManualStatus, isIdle: boolean): DisplayStatus {
  if (manualStatus === "invisible") return "invisible";
  if (manualStatus === "dnd") return "dnd";
  if (manualStatus === "idle") return "idle";
  return isIdle ? "idle" : "online";
}

export const STATUS_LABEL: Record<DisplayStatus | FriendStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
  offline: "Offline",
};

export const STATUS_DOT_CLASS: Record<DisplayStatus | FriendStatus, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-500",
  dnd: "bg-red-500",
  offline: "bg-zinc-500",
  invisible: "bg-zinc-500",
};
