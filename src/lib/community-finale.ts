import { useSyncExternalStore } from "react";

import type { Id } from "../../convex/_generated/dataModel";

/**
 * Which community's "it's ready" overlay is showing, if any.
 *
 * Not component state because the page that starts it doesn't survive it: the
 * create flow navigates to the new community's overview in the same breath, and
 * the overlay has to still be there, laid over that overview, when the page is
 * gone. `CommunityFinaleHost` — mounted for as long as the app is — reads it.
 */
let current: Id<"communities"> | null = null;
const listeners = new Set<() => void>();

function set(next: Id<"communities"> | null) {
  current = next;
  for (const listener of listeners) listener();
}

export const showCommunityFinale = (id: Id<"communities">) => set(id);
export const dismissCommunityFinale = () => set(null);

export function useCommunityFinale(): Id<"communities"> | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
