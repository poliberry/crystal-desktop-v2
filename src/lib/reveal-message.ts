/**
 * After navigating to a room, scroll a message into view and flash it once it has rendered.
 *
 * Message rows carry `data-message-id` (home/message-list.tsx, community/channel-message-list.tsx).
 * The room opens asynchronously, so this looks for the row for a few seconds. A message older than the
 * pages that load first isn't found, and then the room is simply open at its latest messages.
 */
const LOOK_FOR_MS = 4000;
const STEP_MS = 120;
const FLASH_CLASSES = ["ring-2", "ring-primary/70", "ring-inset"];

export function revealMessage(messageId: string): void {
  if (typeof document === "undefined") return;
  const started = Date.now();
  const selector = `[data-message-id="${CSS.escape(messageId)}"]`;
  const look = () => {
    const row = document.querySelector<HTMLElement>(selector);
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add(...FLASH_CLASSES);
      window.setTimeout(() => row.classList.remove(...FLASH_CLASSES), 1800);
      return;
    }
    if (Date.now() - started < LOOK_FOR_MS) window.setTimeout(look, STEP_MS);
  };
  window.setTimeout(look, STEP_MS);
}
