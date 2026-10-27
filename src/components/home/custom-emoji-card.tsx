"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CustomEmojiImage } from "@/components/custom-emoji-image";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A custom emoji in a message, made interactive.
 *
 *  - hover → a tooltip with its `:shortcode:`
 *  - click → a card naming the emoji and the community it belongs to, with a
 *    way into that community when it isn't invite-only
 *
 * Works even for an emoji from a server the reader isn't in — where the
 * message can only show `:name:` as text — since the card fills itself in from
 * `communityEmojis.getInfo`, which doesn't require membership.
 */
export function CustomEmojiChip({
  emojiId,
  name,
  imageUrl,
  jumbo,
}: {
  emojiId: string;
  /** Best name known at render time — the resolved emoji's, or the `:tag:`. */
  name: string;
  /** Present only when the reader shares the emoji's community and can see
   * the picture inline; absent renders the `:name:` text placeholder. */
  imageUrl?: string;
  jumbo?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const trigger = imageUrl ? (
    <CustomEmojiImage
      src={imageUrl}
      name={name}
      className={cn(
        "inline-block align-middle object-contain",
        jumbo ? "size-12" : "size-6"
      )}
    />
  ) : (
    <span className="rounded bg-muted px-0.5 text-[0.95em] text-muted-foreground">
      :{name}:
    </span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`:${name}: emoji`}
                className="inline cursor-pointer align-middle"
              >
                {trigger}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>:{name}:</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="start" side="top" className="w-72 p-0">
        <ErrorBoundary label="Emoji">
          <CustomEmojiCardBody
            emojiId={emojiId}
            fallbackName={name}
            fallbackImageUrl={imageUrl}
            onJoined={() => setOpen(false)}
          />
        </ErrorBoundary>
      </PopoverContent>
    </Popover>
  );
}

function CustomEmojiCardBody({
  emojiId,
  fallbackName,
  fallbackImageUrl,
  onJoined,
}: {
  emojiId: string;
  fallbackName: string;
  fallbackImageUrl?: string;
  onJoined: () => void;
}) {
  const info = useQuery(api.communityEmojis.getInfo, {
    emojiId: emojiId as Id<"communityEmojis">,
  });
  const join = useMutation(api.communities.join);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = info?.name ?? fallbackName;
  const imageUrl = info?.imageUrl ?? fallbackImageUrl;

  const handleJoin = async () => {
    if (!info) return;
    setJoining(true);
    setError(null);
    try {
      await join({ communityId: info.community.id });
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="p-3">
      <div className="flex gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={`:${name}:`}
            className="size-12 shrink-0 rounded object-contain"
          />
        ) : (
          <div className="size-12 shrink-0 rounded bg-muted" />
        )}
        <div className="min-w-0">
          <p className="font-semibold break-all">:{name}:</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {info === undefined
              ? "Loading…"
              : info === null
                ? "This emoji is no longer available."
                : info.viewerIsMember
                  ? "This emoji is from a server you're in. You can use it anywhere."
                  : "This emoji is from a community you're not in yet."}
          </p>
        </div>
      </div>

      {info && (
        <>
          <div className="my-3 h-px bg-border" />
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            This emoji is from
          </p>
          <div className="flex items-center gap-2">
            <Avatar className="size-8 rounded-lg">
              <AvatarImage
                src={info.community.imageUrl}
                alt={info.community.name}
                className="rounded-lg"
              />
              <AvatarFallback className="rounded-lg text-xs">
                {info.community.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {info.community.name}
              </p>
              {!info.viewerIsMember && info.community.inviteOnly && (
                <p className="text-xs text-muted-foreground">Invite-only server</p>
              )}
            </div>
            {!info.viewerIsMember && !info.community.inviteOnly && (
              <Button size="sm" disabled={joining} onClick={() => void handleJoin()}>
                {joining ? "Joining…" : "Join"}
              </Button>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
