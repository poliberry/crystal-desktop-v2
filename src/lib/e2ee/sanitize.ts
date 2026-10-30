/**
 * Client-side clean-up of what comes out of a decrypted message.
 *
 * Embeds and buttons used to be validated by the server (convex/lib/embeds.ts, components.ts) before
 * they were stored. With end-to-end encryption the server only ever sees ciphertext, so anybody who
 * holds the room key (a bot, or a hostile member) can put anything in the payload. Every reader
 * therefore rebuilds the payload here, field by field, before it reaches a renderer.
 *
 * The rules are the server's, with one difference in manner: the server threw so a bot author got an
 * error; a reader has nobody to complain to, so a bad piece is dropped and the rest is kept.
 */

export const EMBED_LIMITS = {
  embeds: 10,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  authorName: 256,
  url: 2000,
  /** Over all the text in all the embeds on one message. */
  total: 6000,
} as const;

/**
 * The words of an encrypted poll, rebuilt like the rest of a decrypted payload: whoever holds the
 * room key wrote them, so they are trusted to be neither the right shape nor the right length. Null
 * unless they fit the poll the server counts (`optionCount` options).
 */
export function safePollWords(raw: unknown, optionCount: number): { question: string; options: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const { question, options } = raw as { question?: unknown; options?: unknown };
  if (typeof question !== "string" || !Array.isArray(options) || options.length !== optionCount) return null;
  if (options.some((o) => typeof o !== "string")) return null;
  const clip = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, max);
  return { question: clip(question, 300), options: (options as string[]).map((o) => clip(o, 100)) };
}

export const COMPONENT_LIMITS = { rows: 5, buttonsPerRow: 5, label: 80, customId: 100, url: 2000 } as const;

export interface SafeEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: number;
  author?: { name: string; url?: string; iconUrl?: string };
  footer?: { text: string; iconUrl?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export type SafeButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";
export interface SafeButton {
  customId?: string;
  label: string;
  style: SafeButtonStyle;
  url?: string;
  emoji?: string;
  disabled?: boolean;
}
export interface SafeActionRow {
  buttons: SafeButton[];
}

// Control characters and bidi overrides, which can reorder text to disguise it.
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Cleaned and cut to `max`. A longer string is clamped rather than refused. */
function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(BAD, "").trim().slice(0, max);
  return s || undefined;
}

/** http(s) only, no credentials, a sane length. `javascript:`, `data:`, `file:` and the like are dropped. */
export function safeUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length === 0 || v.length > EMBED_LIMITS.url) return undefined;
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return undefined;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return undefined;
  return u.href;
}

export function sanitizeEmbeds(input: unknown): SafeEmbed[] {
  if (!Array.isArray(input)) return [];
  let budget: number = EMBED_LIMITS.total;
  /** Text counts against the whole-message budget; what does not fit is dropped. */
  const spend = (s: string | undefined): string | undefined => {
    if (!s) return undefined;
    if (s.length > budget) {
      const cut = s.slice(0, Math.max(0, budget));
      budget = 0;
      return cut || undefined;
    }
    budget -= s.length;
    return s;
  };

  const out: SafeEmbed[] = [];
  for (const raw of input.slice(0, EMBED_LIMITS.embeds)) {
    if (!isObj(raw)) continue;
    const e: SafeEmbed = {};
    const title = spend(text(raw.title, EMBED_LIMITS.title));
    const description = spend(text(raw.description, EMBED_LIMITS.description));
    if (title) e.title = title;
    if (description) e.description = description;
    const url = safeUrl(raw.url);
    if (url) e.url = url;
    if (typeof raw.color === "number" && Number.isInteger(raw.color) && raw.color >= 0 && raw.color <= 0xffffff) e.color = raw.color;
    if (raw.timestamp !== undefined) {
      const t = typeof raw.timestamp === "number" ? raw.timestamp : typeof raw.timestamp === "string" ? Date.parse(raw.timestamp) : NaN;
      if (Number.isFinite(t) && t >= 0 && t <= 4_102_444_800_000) e.timestamp = t;
    }
    if (isObj(raw.author)) {
      const name = spend(text(raw.author.name, EMBED_LIMITS.authorName));
      if (name) {
        e.author = { name };
        const au = safeUrl(raw.author.url);
        const ai = safeUrl(raw.author.iconUrl);
        if (au) e.author.url = au;
        if (ai) e.author.iconUrl = ai;
      }
    }
    if (isObj(raw.footer)) {
      const t = spend(text(raw.footer.text, EMBED_LIMITS.footer));
      if (t) {
        e.footer = { text: t };
        const fi = safeUrl(raw.footer.iconUrl);
        if (fi) e.footer.iconUrl = fi;
      }
    }
    for (const key of ["image", "thumbnail"] as const) {
      const part = raw[key];
      if (!isObj(part)) continue;
      const u = safeUrl(part.url);
      if (u) e[key] = { url: u };
    }
    if (Array.isArray(raw.fields)) {
      const fields: NonNullable<SafeEmbed["fields"]> = [];
      for (const f of raw.fields.slice(0, EMBED_LIMITS.fields)) {
        if (!isObj(f)) continue;
        const name = spend(text(f.name, EMBED_LIMITS.fieldName));
        const value = spend(text(f.value, EMBED_LIMITS.fieldValue));
        if (!name || !value) continue;
        fields.push({ name, value, ...(f.inline === true ? { inline: true } : {}) });
      }
      if (fields.length) e.fields = fields;
    }
    if (Object.keys(e).length > 0) out.push(e);
  }
  return out;
}

const STYLES: readonly SafeButtonStyle[] = ["primary", "secondary", "success", "danger", "link"];
const CUSTOM_ID_RE = /^[\w .:/#@-]{1,100}$/;

export function sanitizeComponents(input: unknown): SafeActionRow[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  const rows: SafeActionRow[] = [];
  for (const row of input.slice(0, COMPONENT_LIMITS.rows)) {
    if (!isObj(row) || !Array.isArray(row.buttons)) continue;
    const buttons: SafeButton[] = [];
    for (const b of row.buttons.slice(0, COMPONENT_LIMITS.buttonsPerRow)) {
      if (!isObj(b)) continue;
      const style = (b.style ?? "secondary") as SafeButtonStyle;
      if (!STYLES.includes(style)) continue;
      const label = text(b.label, COMPONENT_LIMITS.label) ?? "";
      const emoji = text(b.emoji, 64) ?? "";
      if (!label && !emoji) continue;
      const out: SafeButton = { label, style };
      if (emoji) out.emoji = emoji;
      if (b.disabled === true) out.disabled = true;
      if (style === "link") {
        const url = safeUrl(b.url);
        if (!url || b.customId !== undefined) continue;
        out.url = url;
      } else {
        if (typeof b.customId !== "string" || !CUSTOM_ID_RE.test(b.customId) || b.url !== undefined) continue;
        if (ids.has(b.customId)) continue;
        ids.add(b.customId);
        out.customId = b.customId;
      }
      buttons.push(out);
    }
    if (buttons.length) rows.push({ buttons });
  }
  return rows;
}
