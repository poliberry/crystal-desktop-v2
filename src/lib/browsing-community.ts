import { useSyncExternalStore } from "react";

import type { Id } from "../../convex/_generated/dataModel";

/**
 * Which community the content area is showing, if any — the active tab's server, or the one whose
 * front page or members list is open before any channel is picked.
 *
 * The home layout is what knows (it owns the tab and the not-yet-picked views); the sidebar is what
 * wants to know, to swap itself for that community's channels. They are far apart in the tree and
 * neither renders the other, so the answer is published here rather than threaded through props.
 */
let current: Id<"communities"> | null = null;
const listeners = new Set<() => void>();

export function publishBrowsingCommunity(id: Id<"communities"> | null): void {
  if (current === id) return;
  current = id;
  for (const listener of listeners) listener();
}

export function useBrowsingCommunityId(): Id<"communities"> | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => null,
  );
}
