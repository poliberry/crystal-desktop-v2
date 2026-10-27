/**
 * The "Did you know?" lines on the loading screen.
 *
 * Each is something the app really does and that is easy to miss. Written to
 * stand alone and fit on a line or two, and none mention a setting by a name
 * that might change. Add freely — one is picked at random each time the
 * screen shows — but check it is true first: a tip that is wrong is worse than
 * none.
 */
export const TIPS: string[] = [
  "Right-click someone in a call to turn their volume up or down, just for you.",
  "Click a person or a screen share in a call to focus it. Click it again to go back to the grid.",
  "In a call, move your mouse to bring the controls back. They slide away when you're still.",
  "Open the arrow beside the microphone to switch your input and output devices without leaving the call.",
  "The soundboard plays its emoji over your tile for everyone in the call to see.",
  "Starting a server? Pick a template, or paste a template code from a friend.",
  "Click your name, status or bio on your own profile card to edit it right there.",
  "In the decoration and sticker editors, hold Shift while dragging to turn off snapping.",
  "Drop an image straight onto the decoration or sticker canvas to add it.",
  "Ctrl or Cmd + Z undoes your last change in the decoration and sticker editors.",
  "Your avatar, banner and nameplate remember the last five pictures you used.",
  "Set a custom status that clears itself after an hour, a day, or whenever you like.",
  "Switch to dynamic colour and Crystal follows your computer's accent colour.",
  "Press Escape to step back out of Settings and other pages.",
  "Add a custom activity to show what you're up to, even when no game is running.",
  "Drag and drop files into a chat to send them.",
];

/** One at random, never the one just shown. */
export function pickTip(previous?: string): string {
  const options = TIPS.filter((tip) => tip !== previous);
  return options[Math.floor(Math.random() * options.length)]!;
}
