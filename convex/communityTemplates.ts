/**
 * Saved community templates, shared by code.
 *
 * A template is a community's channels, roles and rules with nothing else —
 * no members, no messages, no pictures — so handing the code to someone gives
 * them the shape of the server and none of its contents. The code is the only
 * thing that makes one findable: there is no public list, so a template is as
 * private as the people it was given to.
 */

import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { sanitizeSetup, setupValidator, type CommunitySetup } from "./lib/communitySetup";
import { PERMISSIONS, requireCommunityPermission } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/** Past this it is a library, and a library wants a different screen. */
const MAX_TEMPLATES_PER_USER = 25;

/** No 0/O or 1/I/L, because these get read aloud and typed in. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/** Whatever somebody typed or pasted, down to the code it means. */
function normaliseCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

async function saveTemplate(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  name: string,
  description: string | undefined,
  rawSetup: CommunitySetup,
) {
  const trimmed = name.trim().slice(0, 64);
  if (!trimmed) throw new Error("Give the template a name.");

  const mine = await ctx.db
    .query("communityTemplates")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  if (mine.length >= MAX_TEMPLATES_PER_USER) {
    throw new Error(`You can keep up to ${MAX_TEMPLATES_PER_USER} templates. Delete one first.`);
  }

  const setup = sanitizeSetup(rawSetup);
  if (setup.channels.length === 0) throw new Error("A template needs at least one channel.");

  let code = generateCode();
  while (
    await ctx.db
      .query("communityTemplates")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique()
  ) {
    code = generateCode();
  }

  await ctx.db.insert("communityTemplates", {
    ownerId,
    code,
    name: trimmed,
    description: description?.trim().slice(0, 200) || undefined,
    setup,
    createdAt: Date.now(),
  });
  return code;
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    setup: setupValidator,
  },
  handler: async (ctx, { name, description, setup }) => {
    const me = await getCurrentUserOrThrow(ctx);
    return saveTemplate(ctx, me._id, name, description, setup);
  },
});

/** A template made from a server that already exists — what its channels,
 * roles and rules are right now. */
export const createFromCommunity = mutation({
  args: {
    communityId: v.id("communities"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, name, description }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);

    const [channels, categories, roles, widgets] = await Promise.all([
      ctx.db
        .query("channels")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
      ctx.db
        .query("channelCategories")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
      ctx.db
        .query("roles")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
      ctx.db
        .query("communityWidgets")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    ]);

    const categoryName = new Map(categories.map((c) => [c._id, c.name]));
    const rulesWidget = widgets.find((w) => w.config.kind === "rules");

    return saveTemplate(ctx, me._id, name, description, {
      channels: channels
        .sort((a, b) => a.position - b.position)
        .map((channel) => ({
          name: channel.name,
          type: channel.type,
          topic: channel.topic,
          category: channel.categoryId ? categoryName.get(channel.categoryId) : undefined,
        })),
      roles: roles
        .filter((role) => !role.isEveryone)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          name: role.name,
          color: role.color,
          permissions: role.permissions,
          hoist: role.hoist,
        })),
      rules: rulesWidget && rulesWidget.config.kind === "rules" ? rulesWidget.config.rules : [],
    });
  },
});

/** The template a code names, for the create flow to fill itself in from.
 * `null` for a code that names nothing, so the input can say so as it is typed. */
export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    await getCurrentUserOrThrow(ctx);
    const normalised = normaliseCode(code);
    if (normalised.length !== CODE_LENGTH) return null;
    const template = await ctx.db
      .query("communityTemplates")
      .withIndex("by_code", (q) => q.eq("code", normalised))
      .unique();
    if (!template) return null;
    const owner = await ctx.db.get(template.ownerId);
    return {
      id: template._id,
      code: template.code,
      name: template.name,
      description: template.description,
      authorName: owner?.name,
      uses: template.uses ?? 0,
      setup: template.setup,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const rows = await ctx.db
      .query("communityTemplates")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((template) => ({
        id: template._id,
        code: template.code,
        name: template.name,
        description: template.description,
        uses: template.uses ?? 0,
        setup: template.setup,
      }));
  },
});

export const remove = mutation({
  args: { templateId: v.id("communityTemplates") },
  handler: async (ctx, { templateId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const template = await ctx.db.get(templateId);
    if (!template || template.ownerId !== me._id) throw new Error("That isn't your template.");
    await ctx.db.delete(templateId);
  },
});
