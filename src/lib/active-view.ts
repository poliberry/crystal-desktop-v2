import { useSyncExternalStore } from "react";

/** What the window is showing right now — the conversation or channel the
 * reader is already looking at. A client-side mirror of what HomeLayout
 * reports to the Electron main process for OS notifications (see
 * `getDesktopAPI()?.notifications.setActiveView`), used here so in-app
 * toasts don't pop for the room that's already on screen. */
export type ActiveView = { kind: "conversation" | "channel"; id: string } | null;

let current: ActiveView = null;
const listeners = new Set<() => void>();

export function setActiveView(view: ActiveView): void {
  const same =
    (current === null && view === null) ||
    (current !== null && view !== null && current.kind === view.kind && current.id === view.id);
  if (same) return;
  current = view;
  listeners.forEach((l) => l());
}

export function getActiveView(): ActiveView {
  return current;
}

export function useActiveView(): ActiveView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getActiveView,
    getActiveView
  );
}
