"use client";

import { FileText, ImageIcon, Upload, X } from "lucide-react";
import { useEffect } from "react";

import type { PendingAttachment } from "@/hooks/use-composer-attachments";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The row of staged attachments above the composer input, shared by the DM
 * and channel composers. Images get a thumbnail so a pasted screenshot is
 * recognisable before sending. */
export function ComposerAttachments({
  pending,
  uploading,
  onRemove,
}: {
  pending: PendingAttachment[];
  uploading: boolean;
  onRemove: (index: number) => void;
}) {
  if (pending.length === 0 && !uploading) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {pending.map((attachment, index) => (
        <div
          key={`${attachment.storageId}-${index}`}
          className="group relative flex items-center gap-2 rounded-md border bg-muted/40 p-1.5 pr-7 text-xs"
        >
          {attachment.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.previewUrl}
              alt=""
              className="size-10 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded bg-background/60">
              {attachment.fileType.startsWith("image/") ? (
                <ImageIcon className="size-4 text-muted-foreground" />
              ) : (
                <FileText className="size-4 text-muted-foreground" />
              )}
            </div>
          )}
          <div className="min-w-0 leading-tight">
            <p className="max-w-40 truncate font-medium">{attachment.fileName}</p>
            <p className="text-[10px] text-muted-foreground">{formatSize(attachment.fileSize)}</p>
          </div>
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Remove ${attachment.fileName}`}
            className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground hover:bg-background/80 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {uploading && (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Upload className="size-3.5 animate-pulse" />
          Uploading…
        </div>
      )}
    </div>
  );
}

/** Full-composer overlay shown while files are dragged over it. */
export function ComposerDropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary bg-background/90 text-sm font-medium">
      <Upload className="size-5 text-primary" />
      Drop to attach
    </div>
  );
}

/**
 * Stops a file dropped anywhere *outside* a composer from navigating the
 * window to `file://…`, which is what Chromium does by default and which in
 * Electron replaces the whole app UI with the dropped file. Mounted once,
 * app-wide; the composers' own handlers call `preventDefault` first and are
 * unaffected.
 */
export function FileDropGuard() {
  useEffect(() => {
    const swallow = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);
  return null;
}

