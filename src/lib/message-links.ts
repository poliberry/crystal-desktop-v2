const URL_RE = /https?:\/\/[^\s<]+[^\s<.,:;"')\]]/g;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  return Array.from(new Set(matches));
}

export type UrlKind = "image" | "video" | "link";

export function classifyUrl(url: string): UrlKind {
  if (IMAGE_EXT.test(url)) return "image";
  if (VIDEO_EXT.test(url)) return "video";
  return "link";
}

const INVITE_RE = /joincrystal:([a-zA-Z0-9]{4,32})/g;

/** Pulls every `joincrystal:<code>` invite reference out of a message so it
 * can be rendered as a join-community embed instead of plain text. */
export function extractInviteCodes(text: string): string[] {
  const matches = Array.from(text.matchAll(INVITE_RE)).map((m) => m[1]);
  return Array.from(new Set(matches));
}
