import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireStaff } from "./lib/staff";
import { MAX_PAGES, MAX_REVISIONS, removeDoc, restoreDoc, saveDoc, setDocPublished } from "./lib/studioDocsStore";

/**
 * Studio's guides and articles, as edited in the Admin Console.
 *
 * The app ships a set of pages of its own (the SDK guides, the Bot API reference, the canvas
 * editor's guides). A page saved here with the same address replaces the shipped one for everybody,
 * until it is removed; a page with a new address is added. Published pages can be read by anyone —
 * they are documentation, and the same text ships in the app — while drafts are returned only to
 * staff. Writing needs `docs.write` and is audited; the writes themselves are in
 * `lib/studioDocsStore.ts`.
 */

const shape = (d: Doc<"studioDocs">) => ({
  slug: d.slug,
  title: d.title,
  topic: d.topic,
  kind: d.kind,
  section: d.section,
  summary: d.summary,
  body: d.body,
  order: d.order,
  updatedAt: d.updatedAt,
});

/** Everything published, for the viewer to merge over the pages that ship with the app. */
export const published = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("studioDocs")
      .withIndex("by_published", (q) => q.eq("published", true))
      .take(MAX_PAGES);
    return rows.map(shape);
  },
});

/** Every page including drafts, newest edit first. */
export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "docs.write");
    const rows = await ctx.db.query("studioDocs").take(MAX_PAGES);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows.map((d) => ({ id: d._id, ...shape(d), published: d.published, createdAt: d.createdAt }));
  },
});

export const adminRevisions = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    await requireStaff(ctx, "docs.write");
    const rows = await ctx.db
      .query("studioDocRevisions")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .order("desc")
      .take(MAX_REVISIONS);
    const out = [];
    for (const r of rows) {
      const who = await ctx.db.get(r.editedBy);
      out.push({ id: r._id, title: r.title, body: r.body, createdAt: r.createdAt, editedBy: who ? `@${who.username}` : "someone" });
    }
    return out;
  },
});

/** Make a page, or change one. With `id`, that page (its address may change); without, a new one. */
export const adminSave = mutation({
  args: {
    id: v.optional(v.id("studioDocs")),
    slug: v.string(),
    title: v.string(),
    topic: v.string(),
    kind: v.string(),
    section: v.string(),
    summary: v.string(),
    body: v.string(),
    order: v.number(),
    published: v.boolean(),
  },
  handler: async (ctx, args) => saveDoc(ctx, await requireStaff(ctx, "docs.write"), args),
});

export const adminSetPublished = mutation({
  args: { id: v.id("studioDocs"), published: v.boolean() },
  handler: async (ctx, { id, published }) => setDocPublished(ctx, await requireStaff(ctx, "docs.write"), id, published),
});

/** Delete a page. If it replaced one that ships with the app, the shipped one shows again. */
export const adminRemove = mutation({
  args: { id: v.id("studioDocs") },
  handler: async (ctx, { id }) => removeDoc(ctx, await requireStaff(ctx, "docs.write"), id),
});

/** Put an earlier version's text back (as a new edit, so this too can be undone). */
export const adminRestore = mutation({
  args: { revisionId: v.id("studioDocRevisions") },
  handler: async (ctx, { revisionId }) => restoreDoc(ctx, await requireStaff(ctx, "docs.write"), revisionId),
});
