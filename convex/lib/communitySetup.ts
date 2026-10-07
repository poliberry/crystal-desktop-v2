/**
 * What a new community is made of, as data.
 *
 * The create-community flow, the preset templates and the templates people
 * save and share all describe a server the same way — its channels, its roles
 * and its rules — so there is one shape for it and one place that cleans it up.
 * Everything arrives from a client, so everything is trimmed, capped and
 * range-checked here rather than trusted.
 */

import { type Infer, v } from "convex/values";

import { CHANNEL_SURFACES, type ChannelSurface } from "./communityKinds";

export const MAX_SETUP_CHANNELS = 40;
export const MAX_SETUP_ROLES = 20;
export const MAX_SETUP_RULES = 15;
const MAX_NAME = 64;
const MAX_TOPIC = 256;
const MAX_RULE_TITLE = 120;
const MAX_RULE_BODY = 600;

/** Every permission bit that exists (see `PERMISSIONS`); anything above is
 * noise from a hand-edited template and is dropped. */
const KNOWN_PERMISSION_BITS = (1 << 20) - 1;

export const setupValidator = v.object({
  channels: v.array(
    v.object({
      name: v.string(),
      type: v.union(v.literal("text"), v.literal("voice")),
      topic: v.optional(v.string()),
      /** The category it sits under, by name. Categories are made from the
       * names used here, in the order they first appear. */
      category: v.optional(v.string()),
      /** What a text channel shows instead of messages. Checked against the
       * community's kind by whoever creates it — see `createFromSetup`. */
      surface: v.optional(v.string()),
      /** The clan game it belongs to. */
      gameId: v.optional(v.string()),
    }),
  ),
  /** Highest first: the first role in the list outranks the ones after it. */
  roles: v.array(
    v.object({
      name: v.string(),
      color: v.optional(v.string()),
      permissions: v.number(),
      hoist: v.optional(v.boolean()),
    }),
  ),
  rules: v.array(v.object({ title: v.string(), body: v.optional(v.string()) })),
});

export type CommunitySetup = Infer<typeof setupValidator>;

function clean(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim().slice(0, max);
  return trimmed ? trimmed : undefined;
}

export function sanitizeSetup(setup: CommunitySetup): CommunitySetup {
  const channels = setup.channels
    .map((channel) => ({
      name: clean(channel.name, MAX_NAME),
      type: channel.type,
      topic: clean(channel.topic, MAX_TOPIC),
      category: clean(channel.category, MAX_NAME),
      // Only a text channel can be a surface, and only a surface that exists.
      surface: (CHANNEL_SURFACES as readonly string[]).includes(channel.surface ?? "") && channel.type === "text"
        ? (channel.surface as ChannelSurface)
        : undefined,
      gameId: clean(channel.gameId, 32),
    }))
    .filter((channel): channel is typeof channel & { name: string } => !!channel.name)
    .slice(0, MAX_SETUP_CHANNELS);

  const roles = setup.roles
    .map((role) => ({
      name: clean(role.name, MAX_NAME),
      color: role.color && /^#[0-9a-fA-F]{6}$/.test(role.color) ? role.color : undefined,
      permissions: Math.max(0, Math.floor(role.permissions)) & KNOWN_PERMISSION_BITS,
      hoist: role.hoist,
    }))
    .filter((role): role is typeof role & { name: string } => !!role.name)
    // `@everyone` already exists and is not a thing a template can add.
    .filter((role) => role.name.toLowerCase() !== "@everyone")
    .slice(0, MAX_SETUP_ROLES);

  const rules = setup.rules
    .map((rule) => ({
      title: clean(rule.title, MAX_RULE_TITLE),
      body: clean(rule.body, MAX_RULE_BODY),
    }))
    .filter((rule): rule is typeof rule & { title: string } => !!rule.title)
    .slice(0, MAX_SETUP_RULES);

  return { channels, roles, rules };
}
