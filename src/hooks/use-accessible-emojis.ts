"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ServerEmoji } from "@/lib/custom-emoji";

export interface EmojiCommunityGroup {
  communityId: Id<"communities">;
  communityName: string;
  communityImageUrl?: string;
  emojis: ServerEmoji[];
}

export interface AccessibleEmojis {
  groups: EmojiCommunityGroup[];
  /** By Convex document id — how `<:name:id>` tags in message text resolve. */
  byId: Map<string, ServerEmoji>;
  /** By name — how a typed `:name:` shortcode resolves. First writer wins, so
   * two servers using the same name resolve to whichever sorts first, which
   * at least makes it deterministic. */
  byName: Map<string, ServerEmoji>;
}

const EMPTY: AccessibleEmojis = { groups: [], byId: new Map(), byName: new Map() };

/**
 * Every custom emoji the signed-in user can use, across every community they
 * belong to.
 *
 * Both the picker and the message renderer need this rather than the current
 * community's set alone: a message can carry an emoji from any shared server,
 * and the picker is expected to offer all of them.
 */
export function useAccessibleEmojis(): AccessibleEmojis {
  const groups = useQuery(api.communityEmojis.listAccessible);

  return useMemo(() => {
    if (!groups) return EMPTY;
    const byId = new Map<string, ServerEmoji>();
    const byName = new Map<string, ServerEmoji>();
    for (const group of groups) {
      for (const emoji of group.emojis) {
        byId.set(emoji.id, emoji);
        if (!byName.has(emoji.name)) byName.set(emoji.name, emoji);
      }
    }
    return { groups: groups as EmojiCommunityGroup[], byId, byName };
  }, [groups]);
}
