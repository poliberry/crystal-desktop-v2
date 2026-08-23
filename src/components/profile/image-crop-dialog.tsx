"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  probeAnimation,
  renderAnimatedCrop,
  type AnimatedSource,
} from "@/lib/animated-image";
import { cn } from "@/lib/utils";

/** Max zoom, as a multiple of the "just covers the frame" size. Past this the
 * result is mush on any realistic upload. */
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.01;

export interface CropShape {
  /** Frame aspect ratio, width ÷ height. 1 for an avatar. */
  aspect: number;
  /** Round mask, for avatars — purely a preview cue. The rendered output is
   * always the full square, because that's what an `<img>` gets and every
   * avatar in the app is rounded by CSS. */
  round?: boolean;
  /** Width of the rendered result, in pixels. Height follows from `aspect`. */
  outputWidth: number;
  /**
   * Width used when the source is animated. Smaller than `outputWidth` because
   * the cost is per frame: a 150-frame avatar at 512px is megabytes of WebP,
   * and nothing in the app draws an avatar anywhere near that big anyway.
   */
  animatedOutputWidth: number;
}

export const AVATAR_CROP: CropShape = {
  aspect: 1,
  round: true,
  outputWidth: 512,
  animatedOutputWidth: 256,
};
export const BANNER_CROP: CropShape = {
  aspect: 1200 / 480,
  outputWidth: 1200,
  animatedOutputWidth: 640,
};

/** Viewport width of the editor. Height follows the shape's aspect. */
const FRAME_WIDTH = 400;

interface Transform {
  /** Multiplier on top of the cover-fit scale. 1 means "just covers". */
  zoom: number;
  /** Frame-space offset of the image's centre from the frame's centre. */
  x: number;
  y: number;
}

const IDENTITY: Transform = { zoom: 1, x: 0, y: 0 };

/**
 * Pan-and-zoom crop editor for avatars and banners.
 *
 * Works in "cover" space: the image is first scaled to just fill the frame,
 * and everything the user does is a zoom multiplier on top of that plus an
 * offset. That's what makes the frame impossible to under-fill — the offset is
 * clamped to whatever slack the current zoom leaves, so there is never a
 * transparent edge to render or explain.
 *
 * Output is produced here rather than server-side: the browser already has the
 * image decoded, and the crop is one `drawImage`. The caller uploads both the
 * result and (for a new picture) the untouched original, so the crop can be
 * adjusted later without asking for the file again.
 *
 * An animated source (GIF, animated WebP, APNG) stays animated: the same crop
 * is applied to every frame and re-encoded as an animated WebP — see
 * src/lib/animated-image.ts. The user can turn that off per image, which is
 * also the way out if an animation is too long to encode.
 */
export function ImageCropDialog({
  open,
  onOpenChange,
  source,
  shape,
  title,
  onCropped,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A freshly-picked file, or the URL of an image already stored. */
  source: File | string | null;
  shape: CropShape;
  title: string;
  /** Called with the rendered crop. Resolving is the caller's cue to close. */
  onCropped: (crop: Blob) => Promise<void> | void;
}) {
  const frameHeight = Math.round(FRAME_WIDTH / shape.aspect);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-null when the source turned out to have more than one frame. */
  const [animation, setAnimation] = useState<AnimatedSource | null>(null);
  const [keepAnimation, setKeepAnimation] = useState(true);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  // Decode the source up front: the crop needs its intrinsic size to work
  // out the cover-fit scale, and drawing it to a canvas later needs an image
  // that's already loaded.
  useEffect(() => {
    if (!open || !source) {
      setImage(null);
      setLoading(false);
      return;
    }
    setError(null);
    setTransform(IDENTITY);
    setImage(null);
    setLoading(true);

    const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source);
    const img = new Image();
    // Needed to read the pixels back out of a canvas for a stored image.
    img.crossOrigin = "anonymous";
    let cancelled = false;
    img.onload = () => {
      if (!cancelled) {
        setImage(img);
        setLoading(false);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setError("That image couldn't be loaded.");
        setLoading(false);
      }
    };
    img.src = objectUrl ?? (source as string);

    return () => {
      cancelled = true;
      // Revoked here and nowhere earlier: the preview below renders the same
      // URL, so releasing it the moment decoding finished left the frame
      // pointing at nothing.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, source]);

  // Whether the source is animated is a property of the bytes, not of the
  // decoded first frame, so it's a separate read. A failure here is not worth
  // surfacing: it just means the still path, which always works.
  useEffect(() => {
    if (!open || !source) {
      setAnimation(null);
      return;
    }
    let cancelled = false;
    setAnimation(null);
    setKeepAnimation(true);
    void probeAnimation(source).then((result) => {
      if (!cancelled) setAnimation(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, source]);

  /** Scale at which the image exactly covers the frame. */
  const coverScale = image
    ? Math.max(FRAME_WIDTH / image.naturalWidth, frameHeight / image.naturalHeight)
    : 1;

  /** How far the image can slide before its edge would enter the frame. */
  const slack = useCallback(
    (zoom: number) => {
      if (!image) return { x: 0, y: 0 };
      const scale = coverScale * zoom;
      return {
        x: Math.max(0, (image.naturalWidth * scale - FRAME_WIDTH) / 2),
        y: Math.max(0, (image.naturalHeight * scale - frameHeight) / 2),
      };
    },
    [image, coverScale, frameHeight]
  );

  const clamp = useCallback(
    (next: Transform): Transform => {
      const limit = slack(next.zoom);
      return {
        zoom: next.zoom,
        x: Math.min(limit.x, Math.max(-limit.x, next.x)),
        y: Math.min(limit.y, Math.max(-limit.y, next.y)),
      };
    },
    [slack]
  );

  const onPointerDown = (event: React.PointerEvent) => {
    if (!image) return;
    (event.target as Element).setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX - transform.x,
      startY: event.clientY - transform.y,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((prev) =>
      clamp({ ...prev, x: event.clientX - drag.startX, y: event.clientY - drag.startY })
    );
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    setTransform((prev) =>
      clamp({
        ...prev,
        zoom: Math.min(MAX_ZOOM, Math.max(1, prev.zoom - event.deltaY * 0.002)),
      })
    );
  };

  const setZoom = (zoom: number) => setTransform((prev) => clamp({ ...prev, zoom }));

  const save = async () => {
    if (!image) return;
    setSaving(true);
    setError(null);
    try {
      // Map the frame back onto the source image: the frame covers
      // FRAME_WIDTH/scale source pixels, centred on the image's centre plus
      // whatever the user dragged. Both paths crop the same rectangle — the
      // only difference is how many frames it's applied to.
      const scale = coverScale * transform.zoom;
      const sourceWidth = FRAME_WIDTH / scale;
      const sourceHeight = frameHeight / scale;
      const sourceX = (image.naturalWidth - sourceWidth) / 2 - transform.x / scale;
      const sourceY = (image.naturalHeight - sourceHeight) / 2 - transform.y / scale;

      const animated = animation && keepAnimation;
      const outputWidth = animated ? shape.animatedOutputWidth : shape.outputWidth;
      const outputHeight = Math.round(outputWidth / shape.aspect);

      let blob: Blob | null;
      if (animated) {
        blob = await renderAnimatedCrop({
          animation,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          outputWidth,
          outputHeight,
        });
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Couldn't prepare the image.");

        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          outputWidth,
          outputHeight
        );

        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", 0.92)
        );
      }
      if (!blob) throw new Error("Couldn't render the image.");
      await onCropped(blob);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the image.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Drag to reposition, scroll or use the slider to zoom.
            {animation ? " Every frame gets the same crop." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={onWheel}
            className={cn(
              "relative select-none overflow-hidden border bg-muted/40",
              shape.round ? "rounded-full" : "rounded-md",
              image ? "cursor-grab active:cursor-grabbing" : ""
            )}
            style={{ width: FRAME_WIDTH, height: frameHeight, touchAction: "none" }}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none origin-center"
                style={{
                  width: image.naturalWidth * coverScale * transform.zoom,
                  height: image.naturalHeight * coverScale * transform.zoom,
                  transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px))`,
                }}
              />
            ) : (
              <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Loading image…
                  </>
                ) : (
                  (error ?? "No image")
                )}
              </div>
            )}
          </div>

          <div className="flex w-full items-center gap-3">
            <ZoomOut className="size-4 shrink-0 text-muted-foreground" />
            <Slider
              value={[transform.zoom]}
              min={1}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              disabled={!image}
              onValueChange={([value]) => setZoom(value ?? 1)}
            />
            <ZoomIn className="size-4 shrink-0 text-muted-foreground" />
          </div>

          {animation && (
            <div className="flex w-full items-center justify-between gap-3 rounded-md border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Keep animation</p>
                <p className="text-xs text-muted-foreground">
                  {animation.frameCount} frames. Turn this off to save a single frame at full
                  resolution instead.
                </p>
              </div>
              <Switch
                checked={keepAnimation}
                onCheckedChange={setKeepAnimation}
                disabled={saving}
              />
            </div>
          )}
        </div>

        {error && image && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!image || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
