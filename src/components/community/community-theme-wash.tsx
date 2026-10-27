"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The community's theme, as the tint behind its pages.
 *
 * Two of the community's own colours, as a soft diagonal wash. Nothing is
 * drawn for a community without a theme. It sits at the back of whatever it is
 * put in (`-z-10`, so the parent has to be `relative isolate` or otherwise make
 * its own stacking context, as the channel column and the overview do) and takes
 * no clicks, so everything else is laid out exactly as it was.
 *
 * Kept faint on purpose: a theme is a mood, and the messages on top of it have to
 * stay readable in whatever two colours somebody picked.
 */
export function CommunityThemeWash({
  communityId,
  className,
}: {
  communityId: Id<"communities">;
  className?: string;
}) {
  const community = useQuery(api.communities.get, { communityId });
  if (!community?.themeStart || !community.themeEnd) return null;
  return (
    <div
      aria-hidden
      data-slot="community-theme-wash"
      className={"pointer-events-none absolute inset-0 -z-10 " + (className ?? "")}
      style={{
        background: `linear-gradient(160deg, ${community.themeStart}, ${community.themeEnd})`,
        opacity: 0.16,
      }}
    />
  );
}
