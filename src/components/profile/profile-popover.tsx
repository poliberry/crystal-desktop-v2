"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PopoverContent } from "@/components/ui/popover";
import { frameHeadroom, frameLayout } from "@/lib/profile-cosmetics";
import { cn } from "@/lib/utils";

/**
 * The popover a profile card is shown in.
 *
 * Exists because positioning one correctly needs to know something only the
 * profile knows: how far its frame hangs above the card. Inside a popover the
 * card is deliberately flush with the row it was opened from — a popover clips
 * nothing, so the artwork is left to overflow — but "overflow" and "off the
 * top of the window" are the same thing to a browser, and the frame was
 * sailing up behind the title bar.
 *
 * Radix's collision avoidance only measures the popover's own box, so it can't
 * see the overhang. Telling it to keep that much clear of the top edge is what
 * makes it see it: with room, nothing changes and the card stays level with
 * the row; without, the whole popover slides down until the artwork fits.
 */

/**
 * The app's own chrome along the top — the nav bar, plus the window controls
 * above it on desktop.
 *
 * Counted as unusable space rather than measured, because a popover is
 * portalled to the body and has no reference to whatever is on top of the
 * page. Being a little conservative here costs a few pixels of position and
 * buys never sliding a profile under the title bar.
 */
const APP_TOP_CHROME_PX = 52;

/** Ordinary breathing room from the other three edges. */
const EDGE_PADDING_PX = 8;

/**
 * What a `PopoverContent` hosting a profile card should look like: nothing.
 *
 * The card brings its own surface — a border, a background, a gradient frame,
 * and artwork drawn *outside* its edges. A popover chrome under all that is a
 * second box behind the first, visible as a rectangle sticking out from under
 * the frame. So the popover becomes a positioner and stops being a panel.
 *
 * `w-72` stays: the card has no width of its own and takes the popover's.
 */
export const PROFILE_POPOVER_CLASS =
  "w-72 border-0 bg-transparent p-0 shadow-none";

export function ProfilePopoverContent({
  userId,
  communityId,
  side = "left",
  align = "start",
  className,
  children,
}: {
  /** Whose profile — read here only to find out how tall their frame is. */
  userId: Id<"users">;
  communityId?: Id<"communities">;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const profile = useQuery(api.users.getProfile, { userId, communityId });
  const overhang = profile?.profileFrame
    ? frameHeadroom(frameLayout(profile), true).paddingTop
    : 0;

  return (
    <PopoverContent
      side={side}
      align={align}
      className={cn(PROFILE_POPOVER_CLASS, className)}
      collisionPadding={{
        top: APP_TOP_CHROME_PX + overhang,
        bottom: EDGE_PADDING_PX,
        left: EDGE_PADDING_PX,
        right: EDGE_PADDING_PX,
      }}
    >
      {children}
    </PopoverContent>
  );
}
