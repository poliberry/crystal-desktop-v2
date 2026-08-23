"use client";

import { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { extractPalette } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";

/** Which stop the next clicked swatch fills. Starts on the gradient's start
 * and flips over, so picking two colours is two clicks. */
type Slot = "start" | "end";

/**
 * The avatar frame gradient editor, shared by the global profile tab and the
 * per-server profile dialog.
 *
 * Two colour inputs, plus — when there's a banner to pull from — the banner's
 * own prominent colours as clickable swatches. Sampling the banner is
 * strictly an input helper: it only ever writes the same two hex values the
 * colour inputs do, so nothing downstream needs to know where they came from.
 */
export function GradientPicker({
  start,
  end,
  onStartChange,
  onEndChange,
  bannerUrl,
}: {
  start: string;
  end: string;
  onStartChange: (colour: string) => void;
  onEndChange: (colour: string) => void;
  /** The banner to offer colours from. Absent means no banner uploaded, and
   * the swatch row is hidden entirely. */
  bannerUrl?: string;
}) {
  const [palette, setPalette] = useState<string[]>([]);
  const [slot, setSlot] = useState<Slot>("start");

  useEffect(() => {
    if (!bannerUrl) {
      setPalette([]);
      return;
    }
    let cancelled = false;
    void extractPalette(bannerUrl).then((colours) => {
      if (!cancelled) setPalette(colours);
    });
    return () => {
      cancelled = true;
    };
  }, [bannerUrl]);

  const applySwatch = (colour: string) => {
    if (slot === "start") {
      onStartChange(colour);
      setSlot("end");
    } else {
      onEndChange(colour);
      setSlot("start");
    }
  };

  // The two most prominent colours, which is what most people want and saves
  // them picking at all.
  const applyBoth = () => {
    if (palette.length === 0) return;
    onStartChange(palette[0]);
    onEndChange(palette[1] ?? palette[0]);
    setSlot("start");
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Avatar frame gradient</Label>
        <div className="flex items-end gap-6">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Frame start</p>
            <input
              type="color"
              value={start || "#000000"}
              onChange={(e) => onStartChange(e.target.value)}
              className={cn(
                "size-9 cursor-pointer rounded border border-input p-0.5",
                palette.length > 0 && slot === "start" && "ring-2 ring-ring"
              )}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Frame end</p>
            <input
              type="color"
              value={end || "#000000"}
              onChange={(e) => onEndChange(e.target.value)}
              className={cn(
                "size-9 cursor-pointer rounded border border-input p-0.5",
                palette.length > 0 && slot === "end" && "ring-2 ring-ring"
              )}
            />
          </div>
          {start && end && (
            <div
              className="h-9 flex-1 rounded border border-input"
              style={{ background: `linear-gradient(to bottom, ${start}, ${end})` }}
            />
          )}
        </div>
      </div>

      {palette.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              From your banner — click to set the frame{" "}
              <span className="font-medium text-foreground">{slot}</span>
            </p>
            <Button size="sm" variant="ghost" onClick={applyBoth}>
              <Wand2 className="size-3.5" />
              Use top two
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {palette.map((colour) => (
              <button
                key={colour}
                type="button"
                title={colour}
                aria-label={`Use ${colour} as the frame ${slot}`}
                onClick={() => applySwatch(colour)}
                style={{ backgroundColor: colour }}
                className={cn(
                  "size-8 rounded border border-input transition-transform hover:scale-110",
                  (colour === start || colour === end) && "ring-2 ring-ring ring-offset-1"
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
