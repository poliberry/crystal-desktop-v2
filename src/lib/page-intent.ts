/**
 * "Open this page at that section" — for the places that want to send someone
 * to Settings → Subscriptions, or the shop's collection, rather than to the top
 * of the page.
 *
 * A page is a tab (see `tabs-context.tsx`) whose address has no room for a
 * section, and the page may or may not be open yet. So the request is kept here:
 * a page that is mounting takes what is waiting, and one that is already open
 * hears about it.
 */
export type IntentPage = "settings" | "marketplace";

type Listener = (section: string) => void;

const waiting: Partial<Record<IntentPage, string>> = {};
const listeners: Record<IntentPage, Set<Listener>> = { settings: new Set(), marketplace: new Set() };

export function requestPageSection(page: IntentPage, section: string): void {
  waiting[page] = section;
  for (const listener of listeners[page]) listener(section);
}

/** The section someone asked for before the page opened, once. */
export function takePageSection(page: IntentPage): string | undefined {
  const section = waiting[page];
  delete waiting[page];
  return section;
}

/** Hear about requests while the page is open. */
export function onPageSection(page: IntentPage, listener: Listener): () => void {
  listeners[page].add(listener);
  return () => {
    listeners[page].delete(listener);
  };
}
