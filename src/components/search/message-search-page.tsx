"use client";

import { useEffect, useMemo, useState } from "react";
import { File, Image, LoaderCircle, MessageSquareText, Search } from "lucide-react";

import type { Id } from "../../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { useE2eeSnapshot } from "@/lib/e2ee";
import { getSearchIndex, type SearchHit } from "@/lib/e2ee/search-index";
import { revealMessage } from "@/lib/reveal-message";

type AttachmentFilter = "all" | "images" | "attachments";

function messageText(hit: SearchHit): string {
  const text = hit.text.replace(/\s+/g, " ").trim();
  const value = text || hit.attachments?.map((attachment) => attachment.fileName).join(", ") || "Attachment";
  return value.length > 360 ? `${value.slice(0, 359)}…` : value;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

export function MessageSearchPage({ query }: { query: string }) {
  const nav = useNavigation();
  const e2ee = useE2eeSnapshot();
  const [allHits, setAllHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [attachmentFilter, setAttachmentFilter] = useState<AttachmentFilter>("all");
  const [authorId, setAuthorId] = useState("");
  const index = getSearchIndex();
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (e2ee.status !== "ready" || (!normalizedQuery && attachmentFilter === "all")) {
      setAllHits([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const update = () => {
      if (!live) return;
      setAllHits(index.search(normalizedQuery, {
        limit: 500,
        attachment: !normalizedQuery && attachmentFilter !== "all" ? attachmentFilter : undefined,
      }));
      setLoading(false);
    };
    const unsubscribe = index.subscribe(update);
    void index.ensureAllLoaded().then(update).catch(() => {
      if (live) {
        setAllHits([]);
        setLoading(false);
      }
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [index, normalizedQuery, e2ee.status, attachmentFilter]);

  const authors = useMemo(() => {
    const unique = new Map<string, string>();
    for (const hit of allHits) if (hit.authorId) unique.set(hit.authorId, hit.authorName || "Unknown sender");
    return [...unique].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allHits]);

  const hits = useMemo(
    () => allHits.filter((hit) => {
      if (authorId && hit.authorId !== authorId) return false;
      if (attachmentFilter === "images" && !hit.attachments?.some((item) => item.fileType.startsWith("image/"))) return false;
      if (attachmentFilter === "attachments" && !hit.attachments?.length) return false;
      return true;
    }),
    [allHits, authorId, attachmentFilter],
  );

  const openHit = (hit: SearchHit) => {
    const separator = hit.room.indexOf(":");
    const kind = hit.room.slice(0, separator);
    const target = hit.room.slice(separator + 1);
    if (kind === "dm") nav.openConversation(target as Id<"conversations">);
    else if (hit.communityId) nav.openCommunity(hit.communityId as Id<"communities">, target as Id<"channels">);
    revealMessage(hit.id);
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t bg-background">
      <header className="border-b px-6 py-5">
        <div className="mx-auto w-full max-w-4xl">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Message search</p>
          <h1 className="mt-1 break-words text-xl font-semibold">
            {normalizedQuery ? <>Results for “{normalizedQuery}”</> : "Search attachments"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Searches messages this device has decrypted. Your search stays on this device.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-5 flex flex-wrap items-center gap-2" aria-label="Search filters">
            {(["all", "images", "attachments"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setAttachmentFilter(filter)}
                aria-pressed={attachmentFilter === filter}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${attachmentFilter === filter ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}
              >
                {filter === "all" ? "All messages" : filter === "images" ? "Images" : "Attachments"}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <span>From</span>
              <select
                aria-label="Filter by sender"
                value={authorId}
                onChange={(event) => setAuthorId(event.target.value)}
                className="max-w-48 rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
              >
                <option value="">Anyone</option>
                {authors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>

          <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
            {loading ? "Searching this device…" : `${hits.length}${hits.length === 500 ? "+" : ""} results in your indexed messages`}
          </p>

          {e2ee.status !== "ready" ? (
            <div className="rounded-xl border border-border p-8 text-center">
              <Search className="mx-auto mb-3 size-5 text-muted-foreground" />
              <p className="font-medium">Unlock encryption to search messages</p>
              <p className="mt-1 text-sm text-muted-foreground">Message text is only searchable on devices that have decrypted it.</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Loading this device’s search index…
            </div>
          ) : hits.length === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center">
              <MessageSquareText className="mx-auto mb-3 size-5 text-muted-foreground" />
              <p className="font-medium">{normalizedQuery ? "No matching messages found" : "Search your message history"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {normalizedQuery
                  ? "Search covers content already decrypted on this device. Open older conversations to add more history to its local index."
                  : "Type a phrase in the sidebar, or choose Images or Attachments to browse indexed files."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {hits.map((hit) => {
                const imageOnly = !hit.text.trim() && hit.attachments?.some((item) => item.fileType.startsWith("image/"));
                return (
                  <button
                    key={`${hit.room}:${hit.id}`}
                    type="button"
                    onClick={() => openHit(hit)}
                    className="group flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
                      {imageOnly ? <Image className="size-4" /> : hit.attachments?.length ? <File className="size-4" /> : <MessageSquareText className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium text-foreground">{hit.authorName || "Unknown sender"}</span>
                        <span className="text-muted-foreground">in {hit.room.startsWith("dm:") ? "Direct messages" : `#${hit.channelName || "channel"}`}</span>
                        <time className="ml-auto text-xs text-muted-foreground">{formatDate(hit.createdAt)}</time>
                      </span>
                      <span className="mt-1 block break-words text-sm text-foreground/90">{messageText(hit)}</span>
                      {hit.attachments?.length ? (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {hit.attachments.map((attachment, i) => (
                            <span key={`${attachment.fileName}:${i}`} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {attachment.fileName}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
