/**
 * Where published motion designs live and what their addresses look like. Pure, so the checks that depend on it
 * (a grant may only carry an address of this form) don't need the action that writes the files.
 */

/** The folder published designs live in, under the CDN's address. */
export const MOTION_FOLDER = "marketplace/motion/";
/** A published design is never larger than this: it is fetched whenever somebody's profile is shown. */
export const MAX_MOTION_BYTES = 160 * 1024;

/** `${cdn}/marketplace/motion/<64 hex>.json`, the only form of address a motion grant may carry. */
export function isMotionAddress(url: string): boolean {
  const base = (process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "").replace(/\/$/, "");
  return !!base && url.startsWith(`${base}/${MOTION_FOLDER}`) && /\/[0-9a-f]{64}\.json$/.test(url) && url.length < 300;
}

/** Stable text for a design: keys in a fixed order, so the same design always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
