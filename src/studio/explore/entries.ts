import { haystack, type Topic } from "@/studio/explore/content";
import { groupPages, searchPages, type GuidePage } from "@/studio/docs/pages";
import { DOC_TOPIC_LABELS } from "../../../convex/lib/studioDocs";

/**
 * What Explore lists: the canvas editor's own guides (structured topics, drawn from the code that
 * defines the tools and shortcuts) and the written guides (Markdown pages: the SDK guides that ship
 * with the app, and anything staff add or edit in the Admin Console).
 *
 * One list, one search, one set of groups, so a reader never needs to know where a page comes from.
 * A written page whose address is the id of a structured topic (`tools`, `start`…) replaces it, which
 * is how staff correct a canvas guide without a new release.
 */

export interface Entry {
  id: string;
  group: string;
  title: string;
  summary: string;
  /** Where in its group, for a written page: shown as a small heading when it changes. */
  section?: string;
  topic?: Topic;
  page?: GuidePage;
}

/** The order groups are listed in; any other group follows, alphabetically. */
export const GROUP_ORDER = ["Canvas editor", "Making things", "Code editor", DOC_TOPIC_LABELS.extensions, DOC_TOPIC_LABELS.bots, DOC_TOPIC_LABELS.general];

export function buildEntries(topics: Topic[], pages: GuidePage[]): Entry[] {
  const replaced = new Set(pages.map((p) => p.slug));
  const out: Entry[] = topics.filter((t) => !replaced.has(t.id)).map((t) => ({ id: t.id, group: t.group, title: t.title, summary: t.summary, topic: t }));
  // Reading order: by topic, then by section (in the order each section first appears), then by the
  // page's own order. Flattening by `order` alone would split a section wherever another one's pages interleave.
  for (const g of groupPages(pages)) for (const s of g.sections) for (const page of s.pages) out.push({ id: page.slug, group: g.label, title: page.title, summary: page.summary, section: s.name, page });
  return out;
}

export function groupsOf(entries: Entry[]): string[] {
  const seen = [...new Set(entries.map((e) => e.group))];
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return seen.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Entries mentioning every word typed. Titles rank first for pages; topics keep the order they were written in. */
export function searchEntries(entries: Entry[], query: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  const pageHits = new Set(searchPages(entries.flatMap((e) => (e.page ? [e.page] : [])), query).map((p) => p.slug));
  return entries.filter((e) => (e.topic ? words.every((w) => haystack(e.topic!).includes(w)) : pageHits.has(e.id)));
}
