import { DOC_TOPICS, DOC_TOPIC_LABELS, type DocKind, type DocTopic } from "../../../convex/lib/studioDocs";

/**
 * Studio's guide pages as the app handles them: where they come from, and the pure functions that
 * combine, group and search them. Nothing here reads the network or the DOM, so it is tested alone.
 *
 * A page comes from one of three places, and the reader never has to know which:
 *  - **built-in**: written as Markdown in `content/`, compiled into the app;
 *  - **generated**: built from the code that enforces the facts (the Bot API's routes, permissions
 *    and limits), so the reference can't disagree with the server;
 *  - **edited / added**: saved by staff in the Admin Console. A saved page with the address of a
 *    built-in or generated one replaces it for everybody until it's removed.
 */

export interface PageData {
  slug: string;
  title: string;
  topic: DocTopic;
  kind: DocKind;
  /** The group it is listed under within its topic. */
  section: string;
  summary: string;
  body: string;
  /** Lowest first, within the section. */
  order: number;
}

export type PageSource = "built-in" | "edited" | "added";

export interface GuidePage extends PageData {
  source: PageSource;
  /** When staff last changed it; absent for pages as shipped. */
  updatedAt?: number;
}

/** The shipped pages with the saved ones laid over them: same address replaces, a new one is added. */
export function mergePages(shipped: PageData[], saved: (PageData & { updatedAt?: number })[]): GuidePage[] {
  const bySlug = new Map<string, GuidePage>();
  for (const p of shipped) bySlug.set(p.slug, { ...p, source: "built-in" });
  for (const p of saved) bySlug.set(p.slug, { ...p, source: bySlug.has(p.slug) ? "edited" : "added" });
  return [...bySlug.values()].sort(byOrder);
}

const topicRank = (t: DocTopic) => DOC_TOPICS.indexOf(t);

export function byOrder(a: PageData, b: PageData): number {
  return topicRank(a.topic) - topicRank(b.topic) || a.order - b.order || a.title.localeCompare(b.title);
}

export interface PageGroup {
  topic: DocTopic;
  label: string;
  sections: { name: string; pages: GuidePage[] }[];
}

/** Pages in reading order, grouped by topic and then by section; sections appear in the order of their first page. */
export function groupPages(pages: GuidePage[], only?: DocTopic[]): PageGroup[] {
  const out: PageGroup[] = [];
  for (const page of [...pages].sort(byOrder)) {
    if (only && !only.includes(page.topic)) continue;
    let g = out.find((x) => x.topic === page.topic);
    if (!g) out.push((g = { topic: page.topic, label: DOC_TOPIC_LABELS[page.topic], sections: [] }));
    let s = g.sections.find((x) => x.name === page.section);
    if (!s) g.sections.push((s = { name: page.section, pages: [] }));
    s.pages.push(page);
  }
  return out;
}

/** Pages that mention every word typed, titles first. */
export function searchPages(pages: GuidePage[], query: string): GuidePage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return pages;
  const scored: { page: GuidePage; score: number }[] = [];
  for (const page of pages) {
    const title = page.title.toLowerCase();
    const hay = `${title} ${page.summary} ${page.section} ${page.body}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    scored.push({ page, score: words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (page.summary.toLowerCase().includes(w) ? 1 : 0), 0) });
  }
  return scored.sort((a, b) => b.score - a.score || byOrder(a.page, b.page)).map((s) => s.page);
}

/** Every `doc:` link a page makes, so a link to a page that doesn't exist can be found. */
export function docLinks(body: string): string[] {
  return [...body.matchAll(/\]\(doc:([a-z0-9/-]+)(?:#[\w-]+)?\)/g)].map((m) => m[1]);
}
