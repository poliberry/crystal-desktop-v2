"use client";

import { useCallback } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { useNavigation } from "@/components/home/navigation-context";
import { useAudioPreferences } from "@/components/audio-provider";
import { joinsOn, type GestureEvent } from "@/hooks/use-join-gesture";

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
  const { doubleClickToJoin } = useAudioPreferences();

  return useCallback(
    (
      communityId: Id<"communities">,
      channelId: Id<"channels">,
      type: "text" | "voice",
      /** The click or double click that asked, so "double-click to join" can tell them apart. */
      event?: GestureEvent,
    ) => {
      if (type === "text") {
        // Only the first click of a double click opens a text channel; the second has nothing to add.
        if (event?.type === "dblclick") return;
        nav.openCommunity(communityId, channelId);
        return;
      }
      if (activeCall?.kind === "channel" && activeCall.channelId === channelId) {
        expand();
        return;
      }
      // With "double-click to join" on, a single click on a voice channel does nothing.
      if (!joinsOn(doubleClickToJoin, event)) return;
      dismissJoinError();
      void joinChannelCall(channelId, communityId);
    },
    [nav, activeCall, expand, joinChannelCall, dismissJoinError, doubleClickToJoin],
  );
}
