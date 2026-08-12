"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useRef } from "react";

import { api } from "../../../convex/_generated/api";

interface LinkEmbedCardProps {
  url: string;
}

export function LinkEmbedCard({ url }: LinkEmbedCardProps) {
  const preview = useQuery(api.linkPreviews.get, { url });
  const fetchAndCache = useAction(api.linkPreviews.fetchAndCache);
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (preview === undefined) return;
    if (preview === null && !triggeredRef.current) {
      triggeredRef.current = true;
      void fetchAndCache({ url });
    }
  }, [preview, url, fetchAndCache]);

  if (!preview || preview.status !== "ok") return null;
  if (!preview.title && !preview.description && !preview.image) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex max-w-md gap-3 overflow-hidden rounded-md border bg-muted/40 p-3 hover:bg-muted/60"
    >
      {preview.image && (
        <img src={preview.image} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0">
        {preview.siteName && (
          <p className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {preview.siteName}
          </p>
        )}
        {preview.title && <p className="truncate text-sm font-semibold">{preview.title}</p>}
        {preview.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{preview.description}</p>
        )}
      </div>
    </a>
  );
}
