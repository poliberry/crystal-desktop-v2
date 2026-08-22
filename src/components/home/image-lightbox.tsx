"use client";

import { Download, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

        {/* Backdrop — clicking anywhere that isn't the image closes. */}
        <div
          className="absolute inset-0 flex items-center justify-center p-4 pt-6 pb-8"
          onClick={() => onOpenChange(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={fileName}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full cursor-default rounded-md object-contain shadow-2xl"
          />
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
