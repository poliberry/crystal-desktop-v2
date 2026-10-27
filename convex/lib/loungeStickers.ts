/**
 * The stickers a lounge ships with. Pure data, imported by the server (to know
 * which ids are real) and by the client (to draw them) — the artwork itself is
 * drawn on the client from the id, so nothing here is a URL.
 */
export const LOUNGE_STICKERS = [
  { id: "gg", label: "GG", hue: 145 },
  { id: "lol", label: "LOL", hue: 45 },
  { id: "wow", label: "WOW!", hue: 285 },
  { id: "nice", label: "NICE", hue: 200 },
  { id: "lets-go", label: "LET'S GO", hue: 15 },
  { id: "love", label: "♥", hue: 345 },
  { id: "brb", label: "BRB", hue: 255 },
  { id: "afk", label: "AFK", hue: 220 },
  { id: "gm", label: "GM ☀", hue: 55 },
  { id: "gn", label: "GN ☾", hue: 240 },
  { id: "hype", label: "HYPE", hue: 320 },
  { id: "oof", label: "OOF", hue: 5 },
] as const;

export type LoungeStickerId = (typeof LOUNGE_STICKERS)[number]["id"];

export const isLoungeStickerId = (id: string): id is LoungeStickerId =>
  LOUNGE_STICKERS.some((s) => s.id === id);
