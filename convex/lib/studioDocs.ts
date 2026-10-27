/**
 * Studio's guides and articles: what one is, and the checks on what staff write.
 *
 * Pure, so the server enforces it and the Admin Console can show the same limits. The text is
 * Markdown and is only ever *rendered* by a renderer that doesn't run HTML (see
 * `src/studio/docs/markdown.tsx`); what's checked here is shape and size, not trust in the markup.
 */

export const DOC_KINDS = ["guide", "article", "reference"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Which part of Studio a page is about, so a viewer can show just the pages that matter where it is. */
export const DOC_TOPICS = ["general", "canvas", "extensions", "bots"] as const;
export type DocTopic = (typeof DOC_TOPICS)[number];

export const DOC_TOPIC_LABELS: Record<DocTopic, string> = {
  general: "Studio",
  canvas: "Canvas editor",
  extensions: "Extensions",
  bots: "Bots",
};

export const DOC_KIND_LABELS: Record<DocKind, string> = { guide: "Guide", article: "Article", reference: "Reference" };

export const DOC_LIMITS = { slug: 80, title: 100, section: 40, summary: 240, body: 40_000 } as const;

export interface DocInput {
  slug: string;
  title: string;
  topic: DocTopic;
  kind: DocKind;
  section: string;
  summary: string;
  body: string;
  /** Sorts within a section; lower first. */
  order: number;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** The `slug` as it should be written: lower-case words joined by hyphens, optional folders by `/`. */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/-*\/-*/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "")
    .slice(0, DOC_LIMITS.slug);

/** Rebuilt from whatever was sent: nothing is stored as it arrived. Throws a sentence a person can act on. */
export function normalizeDoc(input: unknown): DocInput {
  if (!input || typeof input !== "object") throw new Error("That page is broken.");
  const raw = input as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");

  const slug = str(raw.slug).trim();
  if (!slug || slug.length > DOC_LIMITS.slug || !SLUG.test(slug)) throw new Error("The address can use lower-case letters, numbers and hyphens, with / between folders. Example: bots/getting-started.");

  const title = str(raw.title).replace(/\s+/g, " ").trim();
  if (title.length < 2) throw new Error("A page needs a title.");
  if (title.length > DOC_LIMITS.title) throw new Error(`The title is over ${DOC_LIMITS.title} characters.`);

  const topic = str(raw.topic) as DocTopic;
  if (!(DOC_TOPICS as readonly string[]).includes(topic)) throw new Error("Choose what the page is about.");
  const kind = str(raw.kind) as DocKind;
  if (!(DOC_KINDS as readonly string[]).includes(kind)) throw new Error("Choose guide, article or reference.");

  const section = str(raw.section).replace(/\s+/g, " ").trim();
  if (!section) throw new Error("A page belongs to a section.");
  if (section.length > DOC_LIMITS.section) throw new Error(`The section name is over ${DOC_LIMITS.section} characters.`);

  const summary = str(raw.summary).replace(/\s+/g, " ").trim();
  if (summary.length > DOC_LIMITS.summary) throw new Error(`The summary is over ${DOC_LIMITS.summary} characters.`);

  // Newlines and tabs are text; other control characters never are.
  // eslint-disable-next-line no-control-regex
  const body = str(raw.body).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (body.trim().length < 1) throw new Error("A page needs some text.");
  if (body.length > DOC_LIMITS.body) throw new Error(`The page is ${body.length.toLocaleString()} characters; the limit is ${DOC_LIMITS.body.toLocaleString()}.`);

  const order = Number(raw.order);
  if (!Number.isFinite(order) || Math.abs(order) > 100_000) throw new Error("The order is a number.");

  return { slug, title, topic, kind, section, summary, body, order: Math.round(order) };
}

/** Only addresses that are safe to follow from a page: this app's own pages and anchors, and https sites. */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  if (h.startsWith("#")) return h;
  // A page inside the guides: `doc:bots/getting-started`.
  if (/^doc:[a-z0-9/-]+(#[\w-]+)?$/.test(h)) return h;
  try {
    const u = new URL(h);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
