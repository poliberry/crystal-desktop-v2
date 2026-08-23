"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { MentionNames, MentionTarget } from "@/lib/mentions";

/** Longest list the composer's dropdown shows before the user should just
 * type more of the name. */
const MAX_SUGGESTIONS = 8;

export interface MentionSuggestion {
  key: string;
  /** What the pill will read as, without the leading `@`. */
  label: string;
  /** Secondary line — a handle, or what a keyword actually does. */
  hint?: string;
  target: MentionTarget;
  imageUrl?: string;
  color?: string;
}

/**
 * Name lookups for rendering the mentions in a message.
 *
 * Reads the member and role lists the app already keeps warm for every
 * community (see DataPreloader), so turning `<@id>` into a name costs nothing
 * beyond what's already subscribed — which matters, because it happens for
 * every message on screen.
 */
export function useMentionNames(communityId: Id<"communities"> | undefined): MentionNames {
  const members = useQuery(
    api.communities.listMembers,
    communityId ? { communityId } : "skip"
  );
  const roles = useQuery(api.roles.list, communityId ? { communityId } : "skip");

  return useMemo(() => {
    const userNames = new Map((members ?? []).map((m) => [m.userId as string, m.name]));
    const roleNames = new Map(
      (roles ?? []).map((r) => [r.id as string, { name: r.name, color: r.color }])
    );
    return {
      user: (id) => userNames.get(id),
      role: (id) => roleNames.get(id),
    };
  }, [members, roles]);
}

/**
 * What to offer after an `@` in a channel composer.
 *
 * Roles, `@everyone` and `@here` are only offered to members who can actually
 * ping them: the server drops those mentions from the notify list without
 * MENTION_EVERYONE (see convex/lib/mentions.ts), and an autocomplete entry
 * that silently does nothing is worse than no entry at all.
 */
export function useMentionSuggestions(
  communityId: Id<"communities">,
  query: string | null
): MentionSuggestion[] {
  const members = useQuery(api.communities.listMembers, { communityId });
  const roles = useQuery(api.roles.list, { communityId });
  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const canMentionAll = hasPermission(myPermissions, PERMISSIONS.MENTION_EVERYONE);

  return useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    const matches = (text: string) => text.toLowerCase().includes(needle);

    const suggestions: MentionSuggestion[] = [];

    if (canMentionAll) {
      // Ahead of the people: someone who types "@e" and means everyone
      // shouldn't have to scroll past every member whose name has an E in it.
      if (matches("everyone")) {
        suggestions.push({
          key: "everyone",
          label: "everyone",
          hint: "Notify every member",
          target: { kind: "everyone" },
        });
      }
      if (matches("here")) {
        suggestions.push({
          key: "here",
          label: "here",
          hint: "Notify members who are online",
          target: { kind: "here" },
        });
      }

      for (const role of roles ?? []) {
        if (role.isEveryone || !matches(role.name)) continue;
        suggestions.push({
          key: `role:${role.id}`,
          label: role.name,
          hint: "Role",
          target: { kind: "role", id: role.id },
          color: role.color,
        });
      }
    }

    for (const member of members ?? []) {
      if (!matches(member.name) && !matches(member.username)) continue;
      suggestions.push({
        key: `user:${member.userId}`,
        label: member.name,
        hint: `@${member.username}`,
        target: { kind: "user", id: member.userId },
        imageUrl: member.imageUrl,
      });
    }

    return suggestions.slice(0, MAX_SUGGESTIONS);
  }, [query, members, roles, canMentionAll]);
}
