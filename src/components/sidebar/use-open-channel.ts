"use client";

import { useCallback } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { useNavigation } from "@/components/home/navigation-context";

/**
 * Open a channel from anywhere in the sidebar: a text channel becomes the
 * active tab, a voice channel is joined — or, when it is the call already
 * running, brought back to the full call screen.
 *
 * The same rule HomeLayout applies to a click on its own channel list, which
 * this replaces; it lives in one place so the community card and the Priority
 * card can't disagree about what clicking a voice channel does.
 */
export function useOpenChannel() {
  const nav = useNavigation();
  const { activeCall, expand, joinChannelCall, dismissJoinError } = useCall();

  return useCallback(
    (
      communityId: Id<"communities">,
      channelId: Id<"channels">,
      type: "text" | "voice",
    ) => {
      if (type === "text") {
        nav.openCommunity(communityId, channelId);
        return;
      }
      if (activeCall?.kind === "channel" && activeCall.channelId === channelId) {
        expand();
        return;
      }
      dismissJoinError();
      void joinChannelCall(channelId, communityId);
    },
    [nav, activeCall, expand, joinChannelCall, dismissJoinError],
  );
}
