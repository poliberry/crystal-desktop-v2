/**
 * Window events for the app-wide overlays the command center hosts (src/components/home/command-center.tsx).
 * Anything can open them without importing their code, which loads only when first used.
 */

export const FOCUS_MESSAGE_SEARCH_EVENT = "crystal:focus-message-search";
export const OPEN_SAVED_MESSAGES_EVENT = "crystal:open-saved-messages";

export function focusMessageSearch(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FOCUS_MESSAGE_SEARCH_EVENT));
}

/** `focusId`: a saved row to scroll to and highlight once the list is open. */
export function openSavedMessages(focusId?: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_SAVED_MESSAGES_EVENT, { detail: { focusId } }));
}

export function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** "⌘K" on a Mac, "Ctrl K" elsewhere. */
export function searchShortcutLabel(): string {
  return isMacLike() ? "⌘K" : "Ctrl K";
}
