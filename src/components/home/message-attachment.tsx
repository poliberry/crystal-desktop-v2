"use client";

import { Download, File as FileIcon, Loader2 } from "lucide-react";
import { useState } from "react";

import { AudioAttachment } from "@/components/home/audio-attachment";
import { ImageLightbox, type LightboxAuthor } from "@/components/home/image-lightbox";
import { VideoAttachment } from "@/components/home/video-attachment";
import { downloadFile, formatBytes } from "@/lib/download";
import { useCachedAttachmentSrc } from "@/lib/image-cache";

/** One row of `messageAttachments`, as the message queries return it. Shared
 * by DM and channel messages — the two tables store attachments identically. */
export interface AttachmentSummary {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string | null;
}

/** An image attachment that expands into the full-screen viewer on click. */
function ImageAttachment({
  attachment,
  author,
  createdAt,
}: {
  attachment: AttachmentSummary;
  author?: LightboxAuthor;
  createdAt?: number;
}) {
  const [open, setOpen] = useState(false);
  // Cached bytes when we have them (see src/lib/image-cache.ts); the raw url
  // meanwhile. Also what makes a just-sent attachment paint without a second
  // download once the real message row replaces the optimistic one.
  const cachedSrc = useCachedAttachmentSrc(attachment.url ?? undefined);
  if (!attachment.url) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 block cursor-zoom-in overflow-hidden rounded-md border transition-opacity hover:opacity-90"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cachedSrc ?? attachment.url}
          alt={attachment.fileName}
          className="max-h-80 max-w-full"
          loading="lazy"
          decoding="async"
        />
      </button>
      <ImageLightbox
        open={open}
        onOpenChange={setOpen}
        url={attachment.url}
        fileName={attachment.fileName}
        author={author}
        createdAt={createdAt}
      />
    </>
  );
}

/**
 * Anything with no inline preview — a `.ttf`, a zip, a PDF — as a row that
 * saves the file when clicked.
 *
 * A button rather than an anchor: Convex serves attachments from its own
 * origin, where `download="…"` is ignored, so an anchor saved every file
 * under its storage ID instead of its real name. `downloadFile` fetches the
 * bytes first so the name we hand the browser is the one that sticks.
 */
function FileAttachment({ attachment }: { attachment: AttachmentSummary }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = attachment.url;
  if (!url) return null;

  const save = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadFile(url, attachment.fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mt-1 w-fit">
      <button
        type="button"
        onClick={() => void save()}
        disabled={downloading}
        title={`Download ${attachment.fileName}`}
        className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-70"
      >
        {downloading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="max-w-48 truncate">{attachment.fileName}</span>
        <span className="text-xs text-muted-foreground">{formatBytes(attachment.fileSize)}</span>
        <Download className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Picks the right presentation for an attachment: inline for the media the
 * app can render, a download row for everything else. */
export function AttachmentView({
  attachment,
  author,
  createdAt,
}: {
  attachment: AttachmentSummary;
  author?: LightboxAuthor;
  createdAt?: number;
}) {
  if (!attachment.url) return null;
  if (attachment.fileType.startsWith("image/")) {
    return <ImageAttachment attachment={attachment} author={author} createdAt={createdAt} />;
  }
  if (attachment.fileType.startsWith("audio/")) {
    return <AudioAttachment url={attachment.url} fileName={attachment.fileName} />;
  }
  if (attachment.fileType.startsWith("video/")) {
    return <VideoAttachment url={attachment.url} fileName={attachment.fileName} />;
  }
  return <FileAttachment attachment={attachment} />;
}
