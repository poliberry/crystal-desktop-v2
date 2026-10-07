"use client";

import { useMutation, useQuery } from "convex/react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CommunityPreview } from "@/components/community/create/community-preview";
import { Button } from "@/components/ui/button";
import type { CommunitySetup } from "@/lib/community-templates";

/** The mock's natural size, in rem — see `CommunityPreview`. */
const MOCK_REM = { width: 36, height: 27 };
/** How long the scan takes to cross the mock. */
const SCAN_SECONDS = 2;
/** Past 100 so the soft trailing edge of the erase has cleared the bottom too. */
const SCAN_END = 112;

/**
 * Deleting a community: a blurred sheet over the whole app asking whether you
 * are sure, and then — once you are — a picture of the community being erased
 * by a scan line while the server does it for real.
 *
 * The picture is the same miniature the create flow draws, built from what the
 * community holds at the moment of confirming. It is a snapshot taken then, not
 * a live read: the deletion removes the very rows it would be drawn from, and
 * the picture would otherwise empty itself out ahead of the scan.
 *
 * The animation and the mutation run side by side and both have to finish
 * before the page lets go, so a slow server holds the picture fully erased
 * rather than the page jumping away mid-scan. If the mutation fails the scan is
 * rewound and the sheet goes back to asking, with the error.
 */
export function DeleteCommunityOverlay({
  communityId,
  name,
  iconUrl,
  bannerUrl,
  onCancel,
  onDeleted,
}: {
  communityId: Id<"communities">;
  name: string;
  iconUrl?: string;
  bannerUrl?: string;
  onCancel: () => void;
  /** Called once it is gone, to leave whatever was showing it. */
  onDeleted: () => void;
}) {
  const remove = useMutation(api.communities.remove);
  const [phase, setPhase] = useState<"confirm" | "erasing">("confirm");
  // Skipped once it is confirmed: these refuse a community that no longer
  // exists, and a query that throws mid-erase would take the picture with it.
  const args = phase === "confirm" ? { communityId } : "skip";
  const channels = useQuery(api.channels.list, args);
  const categories = useQuery(api.channelCategories.list, args);
  const roles = useQuery(api.roles.list, args);

  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CommunitySetup | null>(null);
  const [scale, setScale] = useState(1.4);

  const progress = useMotionValue(0);
  // Everything above the line is already gone; the few percent under it fade
  // out, so the line reads as eating the picture rather than cutting it.
  const mask = useTransform(
    progress,
    (p) => `linear-gradient(to bottom, transparent ${p - 8}%, #000 ${p}%)`,
  );
  const lineTop = useTransform(progress, (p) => `${Math.min(Math.max(p, 0), 100)}%`);
  const lineOpacity = useTransform(progress, [0, 3, 97, 104], [0, 1, 1, 0]);

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

  useEffect(() => {
    const fit = () =>
      setScale(
        Math.min(1.5, (window.innerWidth * 0.8) / (MOCK_REM.width * 16), (window.innerHeight * 0.6) / (MOCK_REM.height * 16)),
      );
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    if (phase !== "confirm") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onCancel]);

  const confirm = async () => {
    setError(null);
    setSnapshot(setup);
    setPhase("erasing");
    progress.set(0);
    const scan = animate(progress, SCAN_END, { duration: SCAN_SECONDS, ease: [0.45, 0, 0.55, 1] });
    try {
      await Promise.all([remove({ communityId }), scan.finished]);
      setLeaving(true);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      onDeleted();
    } catch (err) {
      scan.stop();
      progress.set(0);
      setPhase("confirm");
      setError(err instanceof Error ? err.message : "Couldn't delete the community.");
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      role="alertdialog"
      aria-modal
      aria-labelledby="delete-community-title"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-background/50 px-8 backdrop-blur-2xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: leaving ? 0.45 : 0.25 }}
    >
      {phase === "confirm" ? (
        <motion.div
          className="w-full max-w-md space-y-5 rounded-2xl border border-foreground/10 bg-card/80 p-6 shadow-2xl backdrop-blur-xl"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <TriangleAlert className="size-5" />
            </span>
            <div className="space-y-1">
              <h2 id="delete-community-title" className="text-lg font-semibold">
                Delete {name}?
              </h2>
              <p className="text-sm text-muted-foreground">
                Every channel, message, role and member is removed, and its invites stop working. This
                can&apos;t be undone.
              </p>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" autoFocus onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={channels === undefined || roles === undefined}
              onClick={() => void confirm()}
            >
              {channels === undefined || roles === undefined ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete community
            </Button>
          </div>
        </motion.div>
      ) : (
        <>
          <div
            className="relative shrink-0"
            style={{ width: `${MOCK_REM.width * scale}rem`, height: `${MOCK_REM.height * scale}rem` }}
          >
            <motion.div
              className="absolute top-0 left-0 origin-top-left"
              style={{ transform: `scale(${scale})`, maskImage: mask, WebkitMaskImage: mask }}
            >
              <CommunityPreview
                name={name}
                iconUrl={iconUrl}
                bannerUrl={bannerUrl}
                setup={snapshot ?? setup}
                focus={null}
              />
            </motion.div>
            {/* The scan line: a hairline with a glow trailing up the part it has
                already cleared. */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-x-[-1rem] h-0"
              style={{ top: lineTop, opacity: lineOpacity }}
            >
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-destructive/30 to-transparent" />
              <div className="absolute inset-x-0 h-px bg-destructive shadow-[0_0_14px_3px] shadow-destructive/70" />
            </motion.div>
          </div>
          <p className="text-sm text-muted-foreground">Deleting {name}…</p>
        </>
      )}
    </motion.div>,
    document.body,
  );
}
