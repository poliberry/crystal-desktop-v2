"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ImagePlus, Loader2 } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_BACKGROUND_OPACITY } from "@/components/chat-decoration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { uploadToStorage } from "@/lib/storage-upload";
import {
  MAX_PROFILE_ASSET_BYTES,
  MAX_PROFILE_ASSET_LABEL,
} from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

/**
 * Editing a room's decoration — the picture behind its messages, and (for a
 * channel) the banner under its header.
 *
 * One component for channels and DMs because the controls are identical; only
 * the mutations differ, and which of those to call is decided once by the
 * `target` prop rather than by every control. A DM has no banner: a banner is
 * an announcement to a room of people, and a conversation between two of them
 * has the message box for that.
 */

type Target =
  | { kind: "channel"; channelId: Id<"channels"> }
  | { kind: "conversation"; conversationId: Id<"conversations"> };

/** The opacity slider's steps. Fine enough to find a level, coarse enough
 * that dragging it doesn't fire a mutation per pixel. */
const OPACITY_STEP = 5;

export function ChatDecorationEditor({
  target,
  backgroundUrl,
  backgroundOpacity,
  bannerUrl,
  bannerTitle,
  bannerDescription,
}: {
  target: Target;
  backgroundUrl?: string;
  backgroundOpacity?: number;
  bannerUrl?: string;
  bannerTitle?: string;
  bannerDescription?: string;
}) {
  const setChannelBackground = useMutation(api.channels.setBackground);
  const setChannelBanner = useMutation(api.channels.setBanner);
  const generateChannelUrl = useMutation(api.channels.generateChannelAssetUploadUrl);
  const setConversationBackground = useMutation(
    api.conversations.setConversationBackground,
  );
  const generateConversationUrl = useMutation(
    api.conversations.generateConversationAssetUploadUrl,
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  // Local while dragging: the slider produces a value per frame and each one
  // would otherwise be a write. Committed when the drag ends.
  const [opacity, setOpacity] = useState(
    Math.round((backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY) * 100),
  );
  useEffect(() => {
    setOpacity(Math.round((backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY) * 100));
  }, [backgroundOpacity]);

  const isChannel = target.kind === "channel";

  const upload = async (file: File): Promise<Id<"_storage">> => {
    if (file.size > MAX_PROFILE_ASSET_BYTES) {
      throw new Error(`Images must be smaller than ${MAX_PROFILE_ASSET_LABEL}.`);
    }
    const url = isChannel
      ? await generateChannelUrl({ channelId: target.channelId })
      : await generateConversationUrl({ conversationId: target.conversationId });
    return (await uploadToStorage(url, file)) as Id<"_storage">;
  };

  const run = async (what: string, work: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  const saveBackground = (
    args: { storageId?: Id<"_storage">; opacity?: number; clear?: boolean },
  ) =>
    isChannel
      ? setChannelBackground({ channelId: target.channelId, ...args })
      : setConversationBackground({
          conversationId: target.conversationId,
          ...args,
        });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Background</Label>
        <p className="text-xs text-muted-foreground">
          A picture behind the messages. Everyone here sees it.
        </p>
        <div
          className={cn(
            "h-28 overflow-hidden rounded-md bg-cover bg-center",
            !backgroundUrl &&
              "flex items-center justify-center border-2 border-dashed bg-muted/40",
          )}
          style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}
        >
          {!backgroundUrl && <ImagePlus className="size-5 text-muted-foreground" />}
        </div>

        {backgroundUrl && (
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">
              Strength
            </span>
            <Slider
              value={[opacity]}
              min={0}
              max={100}
              step={OPACITY_STEP}
              onValueChange={([value]) => setOpacity(value ?? 0)}
              // Committed on release rather than on change: dragging is
              // continuous and every step would be a round trip.
              onValueCommit={([value]) =>
                void run("opacity", () =>
                  saveBackground({ opacity: (value ?? 0) / 100 }),
                )
              }
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {opacity}%
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "background"}
            onClick={() => backgroundInput.current?.click()}
          >
            {busy === "background" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : backgroundUrl ? (
              "Replace"
            ) : (
              "Upload background"
            )}
          </Button>
          {backgroundUrl && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => void run("background", () => saveBackground({ clear: true }))}
            >
              Remove
            </Button>
          )}
        </div>
        <input
          ref={backgroundInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void run("background", async () => {
              const storageId = await upload(file);
              // The opacity goes with the first upload so a new background is
              // never applied at whatever the last one happened to use.
              await saveBackground({ storageId, opacity: opacity / 100 });
            });
          }}
        />
      </div>

      {isChannel && (
        <div className="space-y-2">
          <Label>Banner</Label>
          <p className="text-xs text-muted-foreground">
            A strip under the channel header — a faded picture with a heading and
            a line of description. For the thing people need to read first.
          </p>

          <div
            className={cn(
              "h-20 overflow-hidden rounded-md bg-cover bg-center",
              !bannerUrl &&
                "flex items-center justify-center border-2 border-dashed bg-muted/40",
            )}
            style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
          >
            {!bannerUrl && <ImagePlus className="size-5 text-muted-foreground" />}
          </div>

          <div className="space-y-1.5">
            <Input
              defaultValue={bannerTitle ?? ""}
              placeholder="Heading"
              maxLength={80}
              onBlur={(e) =>
                e.target.value !== (bannerTitle ?? "") &&
                void run("banner", () =>
                  setChannelBanner({
                    channelId: target.channelId,
                    title: e.target.value,
                  }),
                )
              }
            />
            <Textarea
              defaultValue={bannerDescription ?? ""}
              placeholder="Description"
              rows={2}
              maxLength={240}
              className="resize-none"
              onBlur={(e) =>
                e.target.value !== (bannerDescription ?? "") &&
                void run("banner", () =>
                  setChannelBanner({
                    channelId: target.channelId,
                    description: e.target.value,
                  }),
                )
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Saved when you click away.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "banner"}
              onClick={() => bannerInput.current?.click()}
            >
              {busy === "banner" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : bannerUrl ? (
                "Replace image"
              ) : (
                "Upload image"
              )}
            </Button>
            {(bannerUrl || bannerTitle || bannerDescription) && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() =>
                  void run("banner", () =>
                    setChannelBanner({ channelId: target.channelId, clear: true }),
                  )
                }
              >
                Remove banner
              </Button>
            )}
          </div>
          <input
            ref={bannerInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run("banner", async () => {
                const storageId = await upload(file);
                await setChannelBanner({ channelId: target.channelId, storageId });
              });
            }}
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
