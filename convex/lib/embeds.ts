/**
 * Rich embeds on a message, which only bots can attach: a card with a coloured edge, a title,
 * text, fields, pictures and a footer, as Discord's.
 *
 * What comes from a bot is untrusted and is *rebuilt* here field by field, never stored as sent:
 * every string is cut to a limit and stripped of control and bidi-override characters, colours
 * are plain integers, addresses must be https with no credentials, and the card as a whole has a
 * size limit. Nothing is rendered as HTML anywhere — see `MessageEmbeds`.
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

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  /** 0xRRGGBB */
  color?: number;
  timestamp?: number;
  author?: { name: string; url?: string; iconUrl?: string };
  footer?: { text: string; iconUrl?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, max: number, what: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`${what} has to be text.`);
  const s = v.replace(BAD, "").trim();
  if (s.length > max) throw new Error(`${what} is up to ${max} characters.`);
  return s || undefined;
}

/** https only, no username or password, a sane length. Returns the parsed, re-serialised address. */
export function embedUrl(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > EMBED_LIMITS.url) throw new Error(`${what} isn't a valid address.`);
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    throw new Error(`${what} isn't a valid address.`);
  }
  if (u.protocol !== "https:" || u.username || u.password) throw new Error(`${what} has to be an https address.`);
  return u.href;
}

export function validateEmbeds(input: unknown): Embed[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("Embeds have to be a list.");
  if (input.length > EMBED_LIMITS.embeds) throw new Error(`A message can have up to ${EMBED_LIMITS.embeds} embeds.`);
  let total = 0;
  const count = (s?: string) => {
    total += s?.length ?? 0;
  };
  const out = input.map((raw, i): Embed => {
    const where = `Embed ${i + 1}`;
    if (!isObj(raw)) throw new Error(`${where} isn't an object.`);
    const e: Embed = {};
    const title = text(raw.title, EMBED_LIMITS.title, `${where}'s title`);
    const description = text(raw.description, EMBED_LIMITS.description, `${where}'s description`);
    if (title) e.title = title;
    if (description) e.description = description;
    count(title);
    count(description);
    const url = embedUrl(raw.url, `${where}'s link`);
    if (url) e.url = url;
    if (raw.color !== undefined) {
      if (typeof raw.color !== "number" || !Number.isInteger(raw.color) || raw.color < 0 || raw.color > 0xffffff) throw new Error(`${where}'s colour has to be a whole number from 0 to 0xFFFFFF.`);
      e.color = raw.color;
    }
    if (raw.timestamp !== undefined) {
      const t = typeof raw.timestamp === "number" ? raw.timestamp : typeof raw.timestamp === "string" ? Date.parse(raw.timestamp) : NaN;
      if (!Number.isFinite(t) || t < 0 || t > 4_102_444_800_000) throw new Error(`${where}'s timestamp isn't a valid time.`);
      e.timestamp = t;
    }
    if (raw.author !== undefined) {
      if (!isObj(raw.author)) throw new Error(`${where}'s author isn't an object.`);
      const name = text(raw.author.name, EMBED_LIMITS.authorName, `${where}'s author name`);
      if (!name) throw new Error(`${where}'s author needs a name.`);
      count(name);
      const a: NonNullable<Embed["author"]> = { name };
      const au = embedUrl(raw.author.url, `${where}'s author link`);
      const ai = embedUrl(raw.author.iconUrl, `${where}'s author icon`);
      if (au) a.url = au;
      if (ai) a.iconUrl = ai;
      e.author = a;
    }
    if (raw.footer !== undefined) {
      if (!isObj(raw.footer)) throw new Error(`${where}'s footer isn't an object.`);
      const t = text(raw.footer.text, EMBED_LIMITS.footer, `${where}'s footer`);
      if (!t) throw new Error(`${where}'s footer needs text.`);
      count(t);
      const f: NonNullable<Embed["footer"]> = { text: t };
      const fi = embedUrl(raw.footer.iconUrl, `${where}'s footer icon`);
      if (fi) f.iconUrl = fi;
      e.footer = f;
    }
    for (const key of ["image", "thumbnail"] as const) {
      if (raw[key] === undefined) continue;
      if (!isObj(raw[key])) throw new Error(`${where}'s ${key} isn't an object.`);
      const u = embedUrl((raw[key] as Record<string, unknown>).url, `${where}'s ${key}`);
      if (!u) throw new Error(`${where}'s ${key} needs an address.`);
      e[key] = { url: u };
    }
    if (raw.fields !== undefined) {
      if (!Array.isArray(raw.fields)) throw new Error(`${where}'s fields have to be a list.`);
      if (raw.fields.length > EMBED_LIMITS.fields) throw new Error(`${where} can have up to ${EMBED_LIMITS.fields} fields.`);
      e.fields = raw.fields.map((f, j) => {
        if (!isObj(f)) throw new Error(`${where}'s field ${j + 1} isn't an object.`);
        const name = text(f.name, EMBED_LIMITS.fieldName, `${where}'s field ${j + 1} name`);
        const value = text(f.value, EMBED_LIMITS.fieldValue, `${where}'s field ${j + 1} value`);
        if (!name || !value) throw new Error(`${where}'s field ${j + 1} needs a name and a value.`);
        count(name);
        count(value);
        return { name, value, ...(f.inline === true ? { inline: true } : {}) };
      });
    }
    if (Object.keys(e).length === 0) throw new Error(`${where} is empty.`);
    return e;
  });
  if (total > EMBED_LIMITS.total) throw new Error(`The embeds hold ${total} characters of text; the limit across one message is ${EMBED_LIMITS.total}.`);
  return out;
}
