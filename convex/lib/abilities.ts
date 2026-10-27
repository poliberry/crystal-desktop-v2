/**
 * The things staff can take away from an account without suspending it.
 *
 * A *limited* account still signs in and can read, but each ability listed on it
 * is refused by the server. Pure data, imported by the server (to enforce it) and
 * by the console (to label the choices) — the same split as `staffPermissions`.
 */

import { v } from "convex/values";

export const ABILITIES = [
  "send_messages",
  "join_communities",
  "create_communities",
  "friend_requests",
  "upload_media",
  "voice_calls",
  "file_reports",
] as const;
export type Ability = (typeof ABILITIES)[number];

/** For function arguments. Written out because `v.union` wants a literal tuple. */
export const abilityValidator = v.union(
  v.literal("send_messages"),
  v.literal("join_communities"),
  v.literal("create_communities"),
  v.literal("friend_requests"),
  v.literal("upload_media"),
  v.literal("voice_calls"),
  v.literal("file_reports"),
);

export const ABILITY_LABELS: Record<Ability, { label: string; description: string }> = {
  send_messages: {
    label: "Send messages",
    description: "Channel messages, direct messages, lounge chat, forum posts and replies, AMA questions.",
  },
  join_communities: { label: "Join communities", description: "Joining a community, by browsing or by invite." },
  create_communities: { label: "Create communities", description: "Starting a new community." },
  friend_requests: { label: "Send friend requests", description: "Asking anyone to be friends." },
  upload_media: {
    label: "Upload media",
    description: "Attachments, avatars and banners, custom emoji, soundboard clips and other uploads.",
  },
  voice_calls: { label: "Join voice and calls", description: "Voice channels, lounges and direct calls." },
  file_reports: { label: "File reports", description: "Reporting a person, message or community." },
};

/** What the person is told when an ability is refused. */
export const ABILITY_REFUSALS: Record<Ability, string> = {
  send_messages: "send messages",
  join_communities: "join communities",
  create_communities: "create communities",
  friend_requests: "send friend requests",
  upload_media: "upload files",
  voice_calls: "join voice channels or calls",
  file_reports: "file reports",
};

/** Narrow arbitrary strings (from a stored row, or a request) to known abilities,
 * dropping unknowns and repeats and keeping the canonical order. */
export function normalizeAbilities(input: readonly string[]): Ability[] {
  const wanted = new Set(input);
  return ABILITIES.filter((ability) => wanted.has(ability));
}
