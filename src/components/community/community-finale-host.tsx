"use client";

import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CommunityPreviewFinale, FINALE_FADE_SECONDS } from "@/components/community/create/community-preview";
import { Button } from "@/components/ui/button";
import { dismissCommunityFinale, useCommunityFinale } from "@/lib/community-finale";
import type { CommunitySetup } from "@/lib/community-templates";

/** The fade, plus a beat so the overlay is already clear when it is let go. */
const FADE_MS = FINALE_FADE_SECONDS * 1000 + 100;

/**
 * The end of creating a community: a blurred sheet over the whole app, with the
 * community's own overview already loaded underneath it, and a picture of it in
 * front. "Go to" fades the picture and the blur away together, which leaves the
 * real thing where the picture was.
 *
 * Drawn from the community as it now is — its name, icon, banner, channels and
 * roles are read back from the server — rather than from what the create flow
 * was holding, whose picture URLs are gone with the page.
 */
export function CommunityFinaleHost() {
  const communityId = useCommunityFinale();
  if (!communityId || typeof document === "undefined") return null;
  return createPortal(<Finale key={communityId} communityId={communityId} />, document.body);
}

function Finale({ communityId }: { communityId: Id<"communities"> }) {
  const community = useQuery(api.communities.get, { communityId });
  const channels = useQuery(api.channels.list, { communityId });
  const categories = useQuery(api.channelCategories.list, { communityId });
  const roles = useQuery(api.roles.list, { communityId });
  const [entering, setEntering] = useState(false);

  const setup = useMemo<CommunitySetup>(
    () => ({
      channels: (channels ?? []).map((c: { name: string; type: "text" | "voice"; categoryId: string | null }) => ({
        name: c.name,
        type: c.type,
        category: (categories ?? []).find((cat: { id: string }) => cat.id === c.categoryId)?.name,
      })),
      roles: (roles ?? [])
        .filter((r: { isEveryone: boolean }) => !r.isEveryone)
        .map((r: { name: string; color?: string; permissions: number; hoist: boolean }) => ({
          name: r.name,
          color: r.color,
          permissions: r.permissions,
          hoist: r.hoist,
        })),
      rules: [],
    }),
    [channels, categories, roles],
  );

  const goTo = async () => {
    setEntering(true);
    await new Promise((resolve) => window.setTimeout(resolve, FADE_MS));
    dismissCommunityFinale();
  };

  const ready = community && channels && roles;

  return (
    <div className="fixed inset-0 z-[100]">
      <motion.div
        className="absolute inset-0 bg-background/40 backdrop-blur-xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: entering ? 0 : 1 }}
        transition={{ duration: entering ? FINALE_FADE_SECONDS : 0.5, ease: "easeInOut" }}
      />
      {ready && (
        <CommunityPreviewFinale
          name={community.name}
          iconUrl={community.imageUrl}
          bannerUrl={community.bannerUrl}
          setup={setup}
          entering={entering}
        >
          <h2 className="text-2xl font-semibold tracking-tight">{community.name} is ready</h2>
          <Button type="button" size="lg" autoFocus disabled={entering} onClick={() => void goTo()}>
            Go to {community.name}
            <ArrowRight className="size-4" />
          </Button>
        </CommunityPreviewFinale>
      )}
    </div>
  );
}
