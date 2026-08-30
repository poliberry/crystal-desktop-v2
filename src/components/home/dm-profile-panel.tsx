"use client";

import { useQuery } from "convex/react";
import { useSmoothScrollRef } from "@/hooks/use-smooth-scroll";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  MemberProfileCard,
  type MemberProfileMember,
} from "@/components/community/member-profile-card";

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
  const smoothRef = useSmoothScrollRef<HTMLDivElement>();

  return (
    <div className="flex w-72 shrink-0 flex-col border-l bg-background/40">
      {/* A plain scroller rather than `ScrollArea`: Radix wraps its viewport's
          children in a `display: table` div, and a percentage height inside
          that resolves to auto — which is exactly what the card needs to fill
          the column. */}
      <div ref={smoothRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* Nothing at all until the query lands, rather than a placeholder
            card: this panel is a copy of information already on screen, and a
            skeleton of it would be the loudest thing in the window. */}
        {member && (
          // `min-h-full` here and `flex-1` on the card: it runs the height of
          // the panel when there's little to say, and grows past it into the
          // scroll when there's a lot.
          <div className="flex min-h-full flex-col p-3">
            <MemberProfileCard
              member={member}
              className="flex-1"
              // The card is *in* the conversation its Message button opens.
              hideMessageAction
            />
          </div>
        )}
      </div>
    </div>
  );
}
