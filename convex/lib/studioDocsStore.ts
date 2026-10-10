import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { audit, type StaffContext } from "./staff";
import { normalizeDoc, type DocInput } from "./studioDocs";

/**
 * The writes behind the Admin Console's guides editor. The caller has already been checked with
 * `requireStaff(ctx, "docs.write")`; these take that result so nothing here can be reached without
 * it, and so the logic can be exercised on its own.
 */

export const MAX_PAGES = 300;
export const MAX_REVISIONS = 20;

/** Remember a page's current text so an edit can be undone, keeping only the latest few. */
async function snapshot(ctx: MutationCtx, d: Doc<"studioDocs">, by: Id<"users">) {
  await ctx.db.insert("studioDocRevisions", { slug: d.slug, title: d.title, body: d.body, editedBy: by, createdAt: Date.now() });
  const all = await ctx.db
    .query("studioDocRevisions")
    .withIndex("by_slug", (q) => q.eq("slug", d.slug))
    .order("desc")
    .collect();
  for (const old of all.slice(MAX_REVISIONS)) await ctx.db.delete(old._id);
}

export async function saveDoc(ctx: MutationCtx, staff: StaffContext, args: { id?: Id<"studioDocs">; published: boolean } & Record<string, unknown>): Promise<Id<"studioDocs">> {
  const page: DocInput = normalizeDoc(args);
  const taken = await ctx.db
    .query("studioDocs")
    .withIndex("by_slug", (q) => q.eq("slug", page.slug))
    .unique();
  const now = Date.now();

  if (args.id) {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("That page no longer exists.");
    if (taken && taken._id !== existing._id) throw new Error("Another page already has that address.");
    // A change of text is remembered so it can be undone; a rename carries the history with it.
    if (existing.title !== page.title || existing.body !== page.body) await snapshot(ctx, existing, staff.user._id);
    if (existing.slug !== page.slug) {
      const history = await ctx.db
        .query("studioDocRevisions")
        .withIndex("by_slug", (q) => q.eq("slug", existing.slug))
        .collect();
      for (const r of history) await ctx.db.patch(r._id, { slug: page.slug });
    }
    await ctx.db.patch(existing._id, { ...page, published: args.published, updatedAt: now, updatedBy: staff.user._id });
    await audit(ctx, staff.user._id, "docs.update", { type: "studioDoc", id: page.slug }, `${page.title}${args.published ? "" : " (draft)"}`);
    return existing._id;
  }

  if (taken) throw new Error("Another page already has that address.");
  const count = (await ctx.db.query("studioDocs").take(MAX_PAGES + 1)).length;
  if (count >= MAX_PAGES) throw new Error(`There can be up to ${MAX_PAGES} pages.`);
  const id = await ctx.db.insert("studioDocs", { ...page, published: args.published, createdAt: now, updatedAt: now, updatedBy: staff.user._id });
  await audit(ctx, staff.user._id, "docs.create", { type: "studioDoc", id: page.slug }, page.title);
  return id;
}

export async function setDocPublished(ctx: MutationCtx, staff: StaffContext, id: Id<"studioDocs">, published: boolean): Promise<void> {
  const d = await ctx.db.get(id);
  if (!d) throw new Error("That page no longer exists.");
  if (d.published === published) return;
  await ctx.db.patch(id, { published, updatedAt: Date.now(), updatedBy: staff.user._id });
  await audit(ctx, staff.user._id, published ? "docs.publish" : "docs.unpublish", { type: "studioDoc", id: d.slug }, d.title);
}

export async function removeDoc(ctx: MutationCtx, staff: StaffContext, id: Id<"studioDocs">): Promise<void> {
  const d = await ctx.db.get(id);
  if (!d) return;
  await ctx.db.delete(id);
  const revisions = await ctx.db
    .query("studioDocRevisions")
    .withIndex("by_slug", (q) => q.eq("slug", d.slug))
    .collect();
  for (const r of revisions) await ctx.db.delete(r._id);
  await audit(ctx, staff.user._id, "docs.delete", { type: "studioDoc", id: d.slug }, d.title);
}

export async function restoreDoc(ctx: MutationCtx, staff: StaffContext, revisionId: Id<"studioDocRevisions">): Promise<void> {
  const rev = await ctx.db.get(revisionId);
  if (!rev) throw new Error("That version is gone.");
  const d = await ctx.db
    .query("studioDocs")
    .withIndex("by_slug", (q) => q.eq("slug", rev.slug))
    .unique();
  if (!d) throw new Error("The page was deleted.");
  await snapshot(ctx, d, staff.user._id);
  await ctx.db.patch(d._id, { title: rev.title, body: rev.body, updatedAt: Date.now(), updatedBy: staff.user._id });
  await audit(ctx, staff.user._id, "docs.restore", { type: "studioDoc", id: d.slug }, d.title);
}
