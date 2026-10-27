"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Film, Loader2, RefreshCw } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { PageHeader, Panel, useStaff } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { useConvex } from "convex/react";
import { loadMotionImages } from "@/lib/motion-render";
import { loadMotionSpec } from "@/lib/motion-load";
import { motionImageUrls } from "../../../../convex/lib/motion";
import { uploadCreation } from "@/lib/creation-upload";

export function CosmeticVideosSection() {
  const staff = useStaff();
  const convex = useConvex();
  const candidates = useQuery(api.cosmeticMigration.candidates);
  const repoint = useMutation(api.cosmeticMigration.repoint);
  const [active, setActive] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const migrate = async (sourceUrl: string): Promise<boolean> => {
    setActive(sourceUrl);
    setError(null);
    try {
      const spec = await loadMotionSpec(sourceUrl);
      if (!spec) throw new Error("Could not load or validate this motion asset.");
      const images = await loadMotionImages(motionImageUrls(spec));
      if (motionImageUrls(spec).some((url) => !images.has(url))) throw new Error("A source image is missing; no records were changed.");
      const { introIdleSpec, recordTransparentWebm, transparentFrameOf } = await import("@/studio/submit");
      const [video, poster] = await Promise.all([recordTransparentWebm(spec, images), transparentFrameOf(spec)]);
      const hash = await crypto.subtle.digest("SHA-256", await video.arrayBuffer());
      const suffix = [...new Uint8Array(hash)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const [videoUrl, posterUrl] = await Promise.all([
        uploadCreation(convex, new File([video], `cosmetic-${suffix}.webm`, { type: "video/webm" })),
        uploadCreation(convex, new File([poster], `cosmetic-${suffix}-poster.png`, { type: "image/png" })),
      ]);
      await repoint({ mappings: [{ sourceUrl, videoUrl, posterUrl, previewUrl: posterUrl, loopFrom: introIdleSpec(spec).loop.from }] });
      setDone((previous) => new Set(previous).add(sourceUrl));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed.");
      return false;
    } finally {
      setActive(null);
    }
  };

  const migrateAll = async () => {
    if (!candidates?.length) return;
    setBatchBusy(true);
    setError(null);
    const failed: string[] = [];
    try {
      for (const item of candidates) {
        if (done.has(item.url)) continue;
        if (!(await migrate(item.url))) failed.push(item.url.split("/").pop() ?? item.url);
      }
      setError(failed.length ? `Could not convert ${failed.length} asset${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}` : null);
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Cosmetic videos" description="Convert legacy Studio timelines to transparent WebM and repoint listings and owners." icon={Film} actions={staff.can("catalog.write") && candidates?.length ? <Button disabled={batchBusy || active !== null} onClick={() => void migrateAll()}>{batchBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {batchBusy ? "Converting all…" : "Convert all"}</Button> : undefined} />
      <Panel>
        <p className="mb-4 text-sm text-muted-foreground">Each conversion preserves the original timeline, uploads a video and transparent poster to the CDN, then updates catalog items, purchases and equipped cosmetics. Failed renders leave existing records untouched.</p>
        {!staff.can("catalog.write") && <p className="text-sm text-muted-foreground">Catalog write permission is needed to migrate assets.</p>}
        {candidates === undefined ? <Loader2 className="size-4 animate-spin" /> : candidates.length === 0 ? <p className="text-sm text-muted-foreground">No legacy Studio motion cosmetics remain.</p> : (
          <div className="divide-y divide-foreground/10">
            {candidates.map((item) => (
              <div key={item.url} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.url.split("/").pop()}</p>
                  <p className="text-xs text-muted-foreground">{item.listings} listing references · {item.owners} owner references</p>
                </div>
                {done.has(item.url) ? <span className="text-xs text-emerald-600">Migrated</span> : (
                  <Button size="sm" variant="outline" disabled={!staff.can("catalog.write") || active !== null || batchBusy} onClick={() => void migrate(item.url)}>
                    {active === item.url ? <Loader2 className="animate-spin" /> : <RefreshCw />} {active === item.url ? "Converting…" : "Convert and repoint"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      </Panel>
    </div>
  );
}
