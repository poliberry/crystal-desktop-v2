"use client";

import { Download, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Opening zoom, as a fraction of the image's true pixel size.
 *
 * Not "fit the window": a screenshot shown at 80% is legible and honest about
 * how big it actually is, where fitting scales a small image up into mush and a
 * large one down until the text in it can't be read. Anything that doesn't fit
 * at 80% scrolls instead.
 */
const DEFAULT_SCALE = 0.8;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
/** Ratio between zoom steps — one button press, or one wheel notch. */
const ZOOM_STEP = 1.25;

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export interface LightboxAuthor {
  name: string;
  imageUrl?: string;
  username?: string;
}

/**
 * Downloading a cross-origin image needs the bytes in hand: the `download`
 * attribute is ignored for another origin, so a plain anchor would navigate to
 * the file instead of saving it. Fetch it, hand the browser a blob URL, then
 * release it.
 */
async function downloadImage(url: string, fileName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName || "image";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking synchronously can cancel the download in some builds; one turn
    // of the event loop is enough for the click to have been consumed.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/**
 * Full-screen viewer for an image attachment. Author, timestamp and the
 * actions live in bars pinned to the top corners so they never cover the
 * image itself, and the backdrop is click-to-dismiss (Escape works too, via
 * the underlying dialog).
 */
export function ImageLightbox({
  open,
  onOpenChange,
  url,
  fileName,
  author,
  createdAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  fileName: string;
  author?: LightboxAuthor;
  createdAt?: number;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The image's true pixel size — known only once it has loaded. */
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  /** Mirrors `scale` so the zoom callbacks can read it without being rebuilt on
   * every step — the wheel listener below is registered once. */
  const scaleRef = useRef(DEFAULT_SCALE);

  // A different image (or the same one reopened) starts at the default zoom
  // rather than inheriting wherever the last one was left.
  useEffect(() => {
    setNatural(null);
    setScale(DEFAULT_SCALE);
    scaleRef.current = DEFAULT_SCALE;
  }, [url, open]);

  /**
   * Zoom, keeping whatever was in the middle of the viewport in the middle.
   *
   * Without this, zooming a large image walks towards its top-left corner: the
   * scroll offsets stay where they are while the content grows underneath them.
   * The correction runs after the browser has laid the new size out, because
   * the scrollable extent it clamps against doesn't exist until then.
   */
  const zoomTo = useCallback((next: number) => {
    const current = scaleRef.current;
    const target = clampScale(next);
    if (target === current) return;
    scaleRef.current = target;
    setScale(target);

    const viewport = viewportRef.current;
    if (!viewport) return;
    const ratio = target / current;
    const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    requestAnimationFrame(() => {
      viewport.scrollLeft = centerX * ratio - viewport.clientWidth / 2;
      viewport.scrollTop = centerY * ratio - viewport.clientHeight / 2;
    });
  }, []);

  const zoomIn = useCallback(() => zoomTo(scaleRef.current * ZOOM_STEP), [zoomTo]);
  const zoomOut = useCallback(() => zoomTo(scaleRef.current / ZOOM_STEP), [zoomTo]);
  const resetZoom = useCallback(() => zoomTo(DEFAULT_SCALE), [zoomTo]);

  // Wheel zoom is wired natively rather than through onWheel because React
  // registers wheel handlers as passive — `preventDefault` is ignored there,
  // and without it the viewport would scroll while zooming.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!open || !viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomTo(scaleRef.current * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [open, zoomTo]);

  // Unmodified +/-/0, deliberately: Ctrl/Cmd with those scales the whole app
  // (Settings -> Accessibility), and this shouldn't fight it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") zoomIn();
      else if (event.key === "-" || event.key === "_") zoomOut();
      else if (event.key === "0") resetZoom();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, zoomIn, zoomOut, resetZoom]);

  // Drag the image to pan, by moving the viewport's scroll rather than the
  // image itself — that way the browser's own scroll limits do the clamping.
  const onPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!natural) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    const pan = panRef.current;
    const viewport = viewportRef.current;
    if (!pan || !viewport || pan.pointerId !== event.pointerId) return;
    viewport.scrollLeft -= event.clientX - pan.x;
    viewport.scrollTop -= event.clientY - pan.y;
    panRef.current = { ...pan, x: event.clientX, y: event.clientY };
  };

  const endPan = (event: React.PointerEvent<HTMLImageElement>) => {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadImage(url, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/85"
        className="top-10 left-0 h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-transparent p-0 shadow-none sm:max-w-none"
      >
        {/* Present for screen readers; the visible header is the bar below. */}
        <DialogTitle className="sr-only">{fileName}</DialogTitle>
        <DialogDescription className="sr-only">
          {author ? `Image sent by ${author.name}` : "Image attachment"}
        </DialogDescription>

        {/* Backdrop — clicking anywhere that isn't the image closes. Scrolls
            rather than clips once the image is zoomed past the window. */}
        <div
          ref={viewportRef}
          className="absolute inset-0 overflow-auto p-4 pt-6 pb-8"
          onClick={() => onOpenChange(false)}
        >
          {/* w-max with min-w-full is what makes both cases work: the wrapper
              grows to the zoomed image's size so the viewport has something to
              scroll, but never shrinks below the viewport, so an image smaller
              than the window stays centred. */}
          <div className="flex min-h-full w-max min-w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={fileName}
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              onLoad={(e) =>
                setNatural({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              // An explicit pixel width once the true size is known — that's
              // what "80% of its true size" means. Until then, fit the window,
              // so a slow-loading image doesn't flash at full resolution.
              style={
                natural
                  ? { width: Math.round(natural.width * scale), maxWidth: "none" }
                  : undefined
              }
              className={cn(
                "rounded-md shadow-2xl select-none",
                natural ? "cursor-grab active:cursor-grabbing" : "max-h-full max-w-full"
              )}
            />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent p-3">
          <div className="pointer-events-auto flex min-w-0 items-center gap-2.5">
            {author && (
              <Avatar size="sm" className="shrink-0">
                <AvatarImage src={author.imageUrl} alt={author.name} />
                <AvatarFallback>{author.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-white">
                {author?.name ?? fileName}
              </p>
              {createdAt !== undefined && (
                <p className="truncate text-[11px] text-white/70">
                  {new Date(createdAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <TooltipProvider>
            <div className="pointer-events-auto flex shrink-0 items-center gap-1">
              {error && (
                <span className="mr-1 max-w-48 truncate text-xs text-destructive">{error}</span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-white hover:bg-white/15 hover:text-white"
                    disabled={scale <= MIN_SCALE}
                    onClick={zoomOut}
                  >
                    <ZoomOut className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Zoom out</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Tabular numerals so stepping through zoom levels doesn't
                      shuffle the buttons either side of it. */}
                  <button
                    type="button"
                    onClick={resetZoom}
                    className="w-14 rounded-md py-1.5 text-center text-xs font-medium text-white tabular-nums hover:bg-white/15"
                  >
                    {Math.round(scale * 100)}%
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Reset to {Math.round(DEFAULT_SCALE * 100)}%
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-white hover:bg-white/15 hover:text-white"
                    disabled={scale >= MAX_SCALE}
                    onClick={zoomIn}
                  >
                    <ZoomIn className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Zoom in</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-white hover:bg-white/15 hover:text-white"
                    disabled={downloading}
                    onClick={() => void handleDownload()}
                  >
                    {downloading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Download</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-white hover:bg-white/15 hover:text-white"
                    onClick={() => onOpenChange(false)}
                  >
                    <X className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Close</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}
