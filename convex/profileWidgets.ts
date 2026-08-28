/**
 * The Board — the widgets someone pins to their profile.
 *
 * A widget is deliberately shapeless: a picture, a title, a subtitle, some
 * description, a list of label/value fields and a list of link buttons. That's
 * enough to be a favourite game, an about-me, a "currently playing" shelf or a
 * list of handles, without this file having to know which of those the user
 * had in mind. The alternative — a `kind` enum with a schema per kind — would
 * mean a deploy every time somebody wanted a new sort of card.
 *
 * Boards are per-scope: the account's own board (no `communityId`) is what a
 * DM or friends-list profile shows, and a board saved against a community
 * replaces it for people in that community. Same rule as every other cosmetic
 * on a server profile.
 */

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireMember } from "./communities";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { MAX_PROFILE_ASSET_BYTES, requireWithinUploadLimit } from "./uploadLimits";

/**
 * Ceilings, enforced here rather than in the schema.
 *
 * A board is read whole every time someone opens a profile, so these exist to
 * keep that read a fixed small size — not because any particular number is
 * meaningful. The client shows the same limits; this is where they bind.
 */
const MAX_WIDGETS = 12;
const MAX_FIELDS = 8;
const MAX_BUTTONS = 3;
const MAX_TITLE = 64;
const MAX_SUBTITLE = 96;
const MAX_DESCRIPTION = 500;
const MAX_LABEL = 40;
const MAX_VALUE = 200;

const widgetFieldValidator = v.object({
  id: v.string(),
  kind: v.union(v.literal("text"), v.literal("image")),
  label: v.string(),
  value: v.string(),
  storageId: v.optional(v.id("_storage")),
});

const widgetButtonValidator = v.object({
  id: v.string(),
  label: v.string(),
  url: v.string(),
});

/**
 * Only `http(s)` links, and only ones that parse.
 *
 * A button is rendered as an anchor somebody else clicks, so anything that
 * could name a scheme with side effects (`javascript:`, `file:`) has no
 * business being stored. Rejected rather than silently dropped, so a typo is
 * reported instead of quietly losing the button.
 */
function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  // A bare "example.com" is what people type; assume the safe scheme rather
  // than refusing it.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`"${raw}" isn't a link.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Buttons can only link to http or https addresses.");
  }
  return parsed.toString();
}

/** Everything a viewer needs, with the storage ids left behind — those are
 * bookkeeping for the owner's mutations, not something to hand out. */
function widgetView(widget: Doc<"profileWidgets">) {
  return {
    id: widget._id,
    position: widget.position,
    title: widget.title,
    subtitle: widget.subtitle,
    description: widget.description,
    imageUrl: widget.imageUrl,
    accent: widget.accent,
    fields: (widget.fields ?? []).map((f) => ({
      id: f.id,
      kind: f.kind,
      label: f.label,
      value: f.value,
    })),
    buttons: widget.buttons ?? [],
  };
}

export type ProfileWidgetView = ReturnType<typeof widgetView>;

/** One board, in `position` order. `communityId` of `undefined` is a real key
 * here — it's how the account's own board is stored, rather than in a table of
 * its own. */
async function widgetsFor(
  ctx: QueryCtx,
  userId: Id<"users">,
  communityId: Id<"communities"> | undefined
): Promise<Doc<"profileWidgets">[]> {
  const rows = await ctx.db
    .query("profileWidgets")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .collect();
  return rows.sort((a, b) => a.position - b.position);
}

/**
 * Somebody's board, as seen from a context.
 *
 * Inside a community the community's board wins *if there is one* — an empty
 * server board means "I haven't made one here", not "I have deliberately shown
 * nothing", so it falls back to the account's rather than leaving a blank tab.
 */
export const listBoard = query({
  args: {
    userId: v.id("users"),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, { userId, communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    if (communityId) {
      const scoped = await widgetsFor(ctx, userId, communityId);
      if (scoped.length > 0) return scoped.map(widgetView);
    }
    const own = await widgetsFor(ctx, userId, undefined);
    return own.map(widgetView);
  },
});

/**
 * The board being *edited*, which is not the same query as the one above.
 *
 * The editor has to be able to see an empty server board — that's the state it
 * exists to change — so this one never falls back. Scoped to the caller for the
 * same reason: you can only edit your own.
 */
export const listMyBoard = query({
  args: { communityId: v.optional(v.id("communities")) },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await widgetsFor(ctx, me._id, communityId);
    return rows.map(widgetView);
  },
});

export const generateWidgetUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/** Membership is what makes a community board yours to write. */
async function requireScope(
  ctx: MutationCtx,
  userId: Id<"users">,
  communityId: Id<"communities"> | undefined
): Promise<void> {
  if (communityId) await requireMember(ctx, communityId, userId);
}

function cleanFields(fields: { id: string; kind: "text" | "image"; label: string; value: string; storageId?: Id<"_storage"> }[]) {
  if (fields.length > MAX_FIELDS) {
    throw new Error(`A widget can hold up to ${MAX_FIELDS} fields.`);
  }
  return fields.map((f) => ({
    id: f.id,
    kind: f.kind,
    label: f.label.trim().slice(0, MAX_LABEL),
    value: f.value.trim().slice(0, MAX_VALUE),
    storageId: f.storageId,
  }));
}

function cleanButtons(buttons: { id: string; label: string; url: string }[]) {
  if (buttons.length > MAX_BUTTONS) {
    throw new Error(`A widget can hold up to ${MAX_BUTTONS} buttons.`);
  }
  return buttons.map((b) => ({
    id: b.id,
    label: b.label.trim().slice(0, MAX_LABEL) || "Open",
    url: normaliseUrl(b.url),
  }));
}

/**
 * Create or replace one widget.
 *
 * Replace rather than patch: the editor is a form over the whole card, and
 * sending the parts that changed would mean the server reconciling two
 * versions of an ordered field list for no benefit. Files that fall out of the
 * new version are deleted here, which is the only moment anything knows they
 * are unreferenced.
 */
export const upsertWidget = mutation({
  args: {
    widgetId: v.optional(v.id("profileWidgets")),
    communityId: v.optional(v.id("communities")),
    title: v.optional(v.string()),
    subtitle: v.optional(v.string()),
    description: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    /** True to drop the cover image. Distinct from omitting
     * `imageStorageId`, which means "leave the one that's there". */
    clearImage: v.optional(v.boolean()),
    accent: v.optional(v.string()),
    fields: v.optional(v.array(widgetFieldValidator)),
    buttons: v.optional(v.array(widgetButtonValidator)),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireScope(ctx, me._id, args.communityId);

    const existing = args.widgetId ? await ctx.db.get(args.widgetId) : null;
    if (args.widgetId && (!existing || existing.userId !== me._id)) {
      throw new Error("That widget isn't yours.");
    }

    let imageUrl = existing?.imageUrl;
    let imageStorageId = existing?.imageStorageId;
    if (args.clearImage) {
      imageUrl = undefined;
      imageStorageId = undefined;
    }
    if (args.imageStorageId) {
      await requireWithinUploadLimit(
        ctx,
        args.imageStorageId,
        MAX_PROFILE_ASSET_BYTES,
        "Widget images"
      );
      const url = await ctx.storage.getUrl(args.imageStorageId);
      if (!url) throw new Error("Widget image upload failed.");
      imageUrl = url;
      imageStorageId = args.imageStorageId;
    }

    const fields = cleanFields(args.fields ?? []);
    const buttons = cleanButtons(args.buttons ?? []);

    const doc = {
      title: args.title?.trim().slice(0, MAX_TITLE) || undefined,
      subtitle: args.subtitle?.trim().slice(0, MAX_SUBTITLE) || undefined,
      description: args.description?.trim().slice(0, MAX_DESCRIPTION) || undefined,
      accent: args.accent?.trim() || undefined,
      imageUrl,
      imageStorageId,
      fields,
      buttons,
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      // Whatever the new version no longer points at: the old cover, and any
      // image field that was removed or re-picked.
      await dropUnreferenced(ctx, existing, imageStorageId, fields);
      return existing._id;
    }

    const siblings = await widgetsFor(ctx, me._id, args.communityId);
    if (siblings.length >= MAX_WIDGETS) {
      throw new Error(`A board holds up to ${MAX_WIDGETS} widgets.`);
    }
    return ctx.db.insert("profileWidgets", {
      userId: me._id,
      communityId: args.communityId,
      position: siblings.length,
      ...doc,
    });
  },
});

/** Delete the blobs an edit or a removal orphaned. */
async function dropUnreferenced(
  ctx: MutationCtx,
  previous: Doc<"profileWidgets">,
  keptImage: Id<"_storage"> | undefined,
  keptFields: { storageId?: Id<"_storage"> }[]
): Promise<void> {
  const kept = new Set<string>();
  if (keptImage) kept.add(keptImage);
  for (const f of keptFields) if (f.storageId) kept.add(f.storageId);

  const candidates: (Id<"_storage"> | undefined)[] = [
    previous.imageStorageId,
    ...(previous.fields ?? []).map((f) => f.storageId),
  ];
  for (const id of candidates) {
    if (!id || kept.has(id)) continue;
    await ctx.storage.delete(id).catch(() => {});
  }
}

export const removeWidget = mutation({
  args: { widgetId: v.id("profileWidgets") },
  handler: async (ctx, { widgetId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const widget = await ctx.db.get(widgetId);
    if (!widget || widget.userId !== me._id) return;
    await ctx.db.delete(widgetId);
    await dropUnreferenced(ctx, widget, undefined, []);
  },
});

/**
 * Write a new order.
 *
 * Takes the whole list rather than a moved id and a target, so the client's
 * drag result is the thing that lands and there's no second interpretation of
 * it here. Ids that aren't the caller's are ignored rather than fatal — a
 * board being reordered while a widget is deleted elsewhere shouldn't fail.
 */
export const reorderWidgets = mutation({
  args: { widgetIds: v.array(v.id("profileWidgets")) },
  handler: async (ctx, { widgetIds }) => {
    const me = await getCurrentUserOrThrow(ctx);
    let position = 0;
    for (const id of widgetIds) {
      const widget = await ctx.db.get(id);
      if (!widget || widget.userId !== me._id) continue;
      await ctx.db.patch(id, { position: position++ });
    }
  },
});
