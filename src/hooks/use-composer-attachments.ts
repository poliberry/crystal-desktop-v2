"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Id } from "../../convex/_generated/dataModel";
import { useIsOnline } from "@/hooks/use-is-online";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL } from "@/lib/upload-limits";

/**
 * Attachment handling shared by the DM and channel composers: the file
 * picker, pasting from the clipboard, and drag-and-drop onto the composer.
 *
 * Uploads go straight to Convex file storage as soon as a file is added, so
 * by the time the user hits Send there's nothing left to wait for — `pending`
 * already holds storage ids. When the upload can't run (offline, or it failed)
 * the entry is kept anyway with the raw `File` and no `storageId`: the durable
 * outbox stashes those bytes and uploads them when the flush reconnects.
 * `previewUrl` is a local object URL used only for the thumbnail chips; the
 * outbox strips the client-only fields before anything reaches the server.
 */

export interface PendingAttachment {
  /** Set once the eager upload lands. Absent means "bytes only, upload later" —
   * the outbox carries the `file` and uploads it on flush. */
  storageId?: Id<"_storage">;
  cdnKey?: string;
  cdnUrl?: string;
  /** Kept so the outbox can stash the bytes (offline send, or reload survival). */
  file?: File;
  fileName: string;
  fileType: string;
  fileSize: number;
  /** Client-only object URL, for image thumbnails in the pending row. */
  previewUrl?: string;
}

/** Guard against a stray multi-hundred-file drop. */
const MAX_FILES = 10;

function isImage(type: string): boolean {
  return type.startsWith("image/");
}

/** Clipboard images arrive as a bare `image.png` (or with no name at all), so
 * give them something distinguishable when several are pasted in a row. */
function nameFor(file: File, index: number): string {
  if (file.name && file.name !== "image.png") return file.name;
  const extension = file.type.split("/")[1]?.split("+")[0] || "png";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `Pasted image ${stamp}${index > 0 ? `-${index + 1}` : ""}.${extension}`;
}

export function useComposerAttachments(
  generateUploadUrl: () => Promise<string>,
  opts?: { convex?: unknown; kind?: "attachments" | "avatars" | "banners" | "emoji" | "sounds" | "backgrounds" }
) {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const online = useIsOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  // dragenter/dragleave also fire when crossing child elements, so the
  // overlay is driven by a depth counter rather than the raw events.
  const dragDepth = useRef(0);
  // Object URLs outlive React state, so unmounting mid-compose would leak
  // them without an explicit sweep.
  const previewUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const revoke = useCallback((url: string | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    previewUrls.current.delete(url);
  }, []);

  const addFiles = useCallback(
    async (files: ArrayLike<File> | null | undefined) => {
      const list = files ? Array.from(files) : [];
      if (list.length === 0) return;

      setError(null);
      const accepted: File[] = [];
      for (const file of list) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(`"${file.name || "File"}" is larger than ${MAX_ATTACHMENT_LABEL}.`);
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length === 0) return;

      const room = MAX_FILES - pending.length;
      if (room <= 0) {
        setError(`You can attach up to ${MAX_FILES} files per message.`);
        return;
      }
      if (accepted.length > room) {
        setError(`Only the first ${room} file${room === 1 ? "" : "s"} were attached.`);
      }

      setUploading(true);
      let deferredAny = false;
      try {
        for (const [index, file] of accepted.slice(0, room).entries()) {
          // Try to upload eagerly: prefer R2 (direct-to-CDN via cdn:createUploadUrl) when configured,
          // fallback to Convex storage. Anything that stops that — offline, failed POST — keeps raw bytes for outbox flush.
          let storageId: Id<"_storage"> | undefined;
          let cdnKey: string | undefined;
          let cdnUrl: string | undefined;
          if (onlineRef.current) {
            try {
              if (opts?.convex) {
                const { tryUploadViaR2 } = await import("@/lib/r2-client");
                const r2 = await tryUploadViaR2(opts.convex as never, file, opts.kind ?? "attachments");
                if (r2) {
                  cdnKey = r2.cdnKey;
                  cdnUrl = r2.cdnUrl;
                }
              }
              if (!cdnKey) {
                const uploadUrl = await generateUploadUrl();
                const res = await fetch(uploadUrl, {
                  method: "POST",
                  headers: { "Content-Type": file.type || "application/octet-stream" },
                  body: file,
                });
                if (res.ok) {
                  ({ storageId } = (await res.json()) as { storageId: Id<"_storage"> });
                }
              }
            } catch {
              // fall through to the deferred path
            }
          }
          if (!storageId && !cdnKey) deferredAny = true;

          let previewUrl: string | undefined;
          if (isImage(file.type)) {
            previewUrl = URL.createObjectURL(file);
            previewUrls.current.add(previewUrl);
          }

          setPending((prev) => [
            ...prev,
            {
              storageId,
              cdnKey,
              cdnUrl,
              file,
              fileName: nameFor(file, index),
              fileType: file.type || "application/octet-stream",
              fileSize: file.size,
              previewUrl,
            },
          ]);
        }
        if (deferredAny) {
          setError(
            onlineRef.current
              ? "Some files will finish uploading when the connection is back."
              : "You're offline — files will upload when you reconnect."
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [generateUploadUrl, pending.length]
  );

  const removeAt = useCallback(
    (index: number) => {
      setPending((prev) => {
        revoke(prev[index]?.previewUrl);
        return prev.filter((_, i) => i !== index);
      });
    },
    [revoke]
  );

  const clear = useCallback(() => {
    setPending((prev) => {
      for (const attachment of prev) revoke(attachment.previewUrl);
      return [];
    });
    setError(null);
  }, [revoke]);

  /**
   * Paste handler for the textarea. Only takes over when the clipboard
   * actually carries files — pasting text (including text copied alongside an
   * image, as browsers often do) must still land in the textarea normally.
   */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;

      // `files` covers screenshots and files copied from the OS file manager.
      // Falling back to `items` catches sources that only expose the entry
      // that way.
      const files = data.files.length
        ? Array.from(data.files)
        : Array.from(data.items)
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);

      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    },
    [addFiles]
  );

  // `addFiles` changes identity whenever an attachment is added; keeping it in
  // a ref stops the drop listeners below from re-registering mid-drag, which
  // would strand the depth counter and leave the overlay stuck on.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  useEffect(() => {
    // Listeners go on the composer's *parent* — the column that also holds
    // the message list — so a file can be dropped anywhere over the
    // conversation instead of only on the composer strip. Scoped to that
    // subtree rather than `window`, so it stays unambiguous if more than one
    // composer is ever mounted at a time.
    const zone = dropZoneRef.current?.parentElement ?? dropZoneRef.current;
    if (!zone) return;

    const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setIsDraggingOver(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Without this the drop event never fires.
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // dragenter/dragleave fire again on every child crossed, so only the
      // outermost leave should clear the overlay.
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDraggingOver(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setIsDraggingOver(false);
      void addFilesRef.current(event.dataTransfer!.files);
    };

    zone.addEventListener("dragenter", onDragEnter);
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);
    return () => {
      zone.removeEventListener("dragenter", onDragEnter);
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDrop);
    };
  }, []);

  return {
    pending,
    uploading,
    error,
    dismissError: () => setError(null),
    isDraggingOver,
    fileInputRef,
    /** Attach to the composer's root element; the drop zone is its parent. */
    dropZoneRef,
    openFilePicker: () => fileInputRef.current?.click(),
    addFiles,
    removeAt,
    clear,
    handlePaste,
  };
}
