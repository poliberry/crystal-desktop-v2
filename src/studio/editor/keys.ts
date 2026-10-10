export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * A shortcut written once as `mod+alt+shift+;` and shown the way the platform
 * writes it: `⌥⇧⌘;` on a Mac (Apple's order — Control, Option, Shift, Command),
 * `Ctrl+Alt+Shift+;` elsewhere. `mod` is ⌘ on a Mac and Ctrl elsewhere, which is
 * also what the keyboard handlers treat as the command key.
 */
export function keyLabel(combo: string): string {
  // The key itself may be "+" (`mod++`), which a plain split would lose.
  const literalPlus = combo.endsWith("++");
  const parts = (literalPlus ? combo.slice(0, -2) : combo).split("+").map((p) => p.trim());
  const key = literalPlus ? "+" : parts[parts.length - 1];
  const has = (m: string) => (literalPlus ? parts : parts.slice(0, -1)).includes(m);
  const shown = key.length === 1 ? key.toUpperCase() : key;
  // `ctrl` is the Control key itself (VS Code's terminal toggle); `mod` is ⌘ on a Mac and Ctrl elsewhere.
  if (IS_MAC) return `${has("ctrl") ? "⌃" : ""}${has("alt") ? "⌥" : ""}${has("shift") ? "⇧" : ""}${has("mod") ? "⌘" : ""}${shown}`;
  return [(has("mod") || has("ctrl")) && "Ctrl", has("alt") && "Alt", has("shift") && "Shift", shown].filter(Boolean).join("+");
}
