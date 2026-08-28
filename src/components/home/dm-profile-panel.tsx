"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  MemberProfileCard,
  type MemberProfileMember,
} from "@/components/community/member-profile-card";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * The other person's profile card, kept open beside a one-to-one DM.
 *
 * What a group DM shows here is a member list, which a conversation between two
 * people has no use for — the list would be one row, and the row is already the
 * header. The card is the same one their avatar opens as a popover anywhere
 * else, just left standing: in a DM you are talking to exactly one person, so
 * who they are is context for the whole screen rather than something to go and
 * look up.
 *
 * It reads the same query the member list does, so the card gets a banner, a
 * bio and the colours the popover has — `conversations.get` carries only what
 * a header needs.
 */
export function DmProfilePanel({
  conversationId,
  userId,
}: {
  conversationId: Id<"conversations">;
  userId: Id<"users">;
}) {
  const members = useQuery(api.conversations.listMembersWithPresence, {
    conversationId,
  }) as MemberProfileMember[] | undefined;
  const member = members?.find((entry) => entry.userId === userId);

  return (
    <div className="w-72 shrink-0 border-l bg-background/40">
      <ScrollArea className="h-full">
        {/* Nothing at all until the query lands, rather than a placeholder
            card: this panel is a copy of information already on screen, and a
            skeleton of it would be the loudest thing in the window. */}
        {member && (
          <div className="p-3">
            <MemberProfileCard member={member} />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
